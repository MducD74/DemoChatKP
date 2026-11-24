// Nhận sự kiện chuẩn hóa, ghi vào kho. Chống trùng theo (kênh, externalId của tin).
import { mutate, type DB, type Store } from "./store";
import { applyRouting } from "./routing";
import { DEMO_STAFF } from "./staff";
import { brandOfChannel } from "./brands";

const AGENTS = DEMO_STAFF.filter((s) => s.role === "agent").map((s) => s.uid);
import type { Channel, InboundEvent } from "./types";

export interface IngestResult {
  stored: number;
  duplicates: number;
  unknownChannel: number;
  // Khách chưa có tên (chỉ có mã của kênh): cần lấy hồ sơ sau khi ghi tin
  needProfile: Array<{ contactId: string; channelId: string; externalId: string }>;
  // Ảnh vừa nhận còn nằm ở máy chủ của kênh (Meta): cần tải về kho ảnh của KP Chat (inboundmedia.ts)
  newMedia: Array<{ messageId: string; index: number; url: string }>;
}

const id = (...p: string[]) => p.join(":");
const PROFILE_RETRY_MS = 3600_000;

// history: tin cũ tải về từ kênh. Không chia khách, không mở lại hội thoại đã xong, không tính SLA, không báo chưa đọc.
// catchUp: khôi phục tin bị lỡ (webhook ngắt). Ghi như tin mới (mở lại hội thoại, chia khách, báo chưa đọc) nhưng KHÔNG đánh thức chatbot,
// vì tin đã cũ và người có thể đã trả lời bằng cách khác.
export interface IngestOpts { history?: boolean; catchUp?: boolean }

// Bên nghe tin khách mới (chatbot đăng ký ở đây). Đặt trên globalThis để mọi gói mã của Next dùng chung một danh sách.
type InboundListener = (store: Store, conversationIds: string[]) => void;
const g = globalThis as unknown as { __kpInbound?: Map<string, InboundListener> };
export const onInbound = (name: string, fn: InboundListener) => void (g.__kpInbound ??= new Map()).set(name, fn);

export async function ingest(store: Store, channelKind: string, events: InboundEvent[], opts: IngestOpts = {}): Promise<IngestResult> {
  const touched = new Set<string>();
  const res = await mutate(store, (db) => ingestInto(db, channelKind, events, opts, touched));
  if (touched.size && g.__kpInbound) {
    for (const fn of g.__kpInbound.values()) {
      try { fn(store, [...touched]); } catch { /* bên nghe lỗi không được làm hỏng việc nhận tin */ }
    }
  }
  return res;
}

function ingestInto(db: DB, channelKind: string, events: InboundEvent[], opts: IngestOpts, touched?: Set<string>): IngestResult {
  const history = !!opts.history;
  const res: IngestResult = { stored: 0, duplicates: 0, unknownChannel: 0, needProfile: [], newMedia: [] };
  for (const ev of events) {
    // Ưu tiên kênh đang nối: một Page từng gỡ rồi nối lại có thể còn một kênh cũ (off) cùng mã, không được để nó chặn tin.
    // Instagram: webhook ghi id tài khoản Instagram; nếu Meta gửi id Page liên kết thì khớp theo meta.pageId (tài liệu chưa nói rõ trường này).
    const all = Object.values(db.channels).filter((c) => c.kind === channelKind);
    const ch: Channel | undefined =
      all.find((c) => c.externalId === ev.channelExternalId && !c.off) ??
      (channelKind === "instagram" ? all.find((c) => c.meta?.pageId === ev.channelExternalId && !c.off) : undefined) ??
      all.find((c) => c.externalId === ev.channelExternalId);
    if (!ch || ch.off) {
      res.unknownChannel++;
      continue;
    }
    const msgId = id(ch.id, ev.message.externalId);
    if (db.messages[msgId]) {
      res.duplicates++;
      continue;
    }
    const contactId = id(ch.id, ev.contact.externalId);
    const convId = id(ch.id, "conv", ev.contact.externalId);
    db.contacts[contactId] ??= {
      id: contactId,
      companyId: ch.companyId,
      channelId: ch.id,
      externalId: ev.contact.externalId,
      name: ev.contact.name ?? ev.contact.externalId,
      phone: ev.contact.phone,
      avatarUrl: ev.contact.avatarUrl,
    };
    const ct = db.contacts[contactId];
    // Tin lịch sử có tên khách thật thì bổ sung cho khách chỉ có mã
    if (ev.contact.name && ct.name === ct.externalId) ct.name = ev.contact.name;
    // Chưa có tên thật thì cần lấy hồ sơ; thử lại tối đa mỗi giờ một lần cho mỗi khách
    if (!history && ct.name === ct.externalId && !ct.avatarUrl && Date.now() - (ct.profileAt ?? 0) > PROFILE_RETRY_MS && !res.needProfile.some((n) => n.contactId === contactId)) {
      res.needProfile.push({ contactId, channelId: ch.id, externalId: ct.externalId });
    }
    const conv = (db.conversations[convId] ??= {
      id: convId,
      companyId: ch.companyId,
      channelId: ch.id,
      contactId,
      status: history ? "resolved" : "open", // hội thoại cũ tải về coi như đã xong, mở lại khi khách nhắn mới
      labels: [],
      ...(brandOfChannel(db, ch.id) ? { brandId: brandOfChannel(db, ch.id) } : {}),
    });
    if (ev.conversationExternalId) conv.externalId ??= ev.conversationExternalId;
    db.messages[msgId] = {
      id: msgId,
      companyId: ch.companyId,
      conversationId: convId,
      externalId: ev.message.externalId,
      direction: ev.message.direction,
      text: ev.message.text,
      attachments: ev.message.attachments,
      at: ev.message.at,
      ...(history ? { history: true } : {}),
    };
    ev.message.attachments.forEach((a, index) => { if (a.type === "image" && /^https:\/\//.test(a.url)) res.newMedia.push({ messageId: msgId, index, url: a.url }); });
    conv.lastMessageAt = Math.max(conv.lastMessageAt ?? 0, ev.message.at);
    if (ev.message.direction === "in") {
      if (ev.message.at >= (conv.lastInboundAt ?? 0)) conv.lastInboundHistory = history ? true : undefined;
      conv.lastInboundAt = Math.max(conv.lastInboundAt ?? 0, ev.message.at);
      if (!history) {
        if (conv.status === "resolved") conv.status = "open";
        // Chia khách tự động khi hội thoại chưa có người phụ trách (theo cấu hình của kênh)
        applyRouting(db, conv, AGENTS, Date.now());
        if (!opts.catchUp) touched?.add(convId);
      }
    }
    res.stored++;
  }
  return res;
}
