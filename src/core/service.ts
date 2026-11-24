// Dịch vụ hộp thư: các thao tác mà API và giao diện gọi. Chưa có phân quyền (sẽ qua host adapter).
import { messagesByConv, messagesOf, mutate, type DB, type Store } from "./store";
export { listTemplates, saveTemplate, deleteTemplate, renderTemplate } from "./library";
import type { Attachment, Channel, ConvStatus, Conversation, Message, TaskPriority } from "./types";
import { sendMessage } from "./send";
import type { Actor } from "./staff";
import { canAct, canAssign, canView, isAdmin } from "./policy";
import { cleanLabelCfg, DEFAULT_LABEL_CFG, type LabelCfg } from "./labels";
import { LOST_REASONS, stageOf, TASK_LIMITS } from "./convmeta";
import { hostProfile } from "./hostprofile";
import { pickBot } from "./chatbot";
import { cleanChannelGroups, type ChannelGroup } from "./channelgroups";
import { botHandlers } from "./botassign";
import type { BotState } from "./botfilter";
import { DEMO_STAFF } from "./staff";
import { cleanSla, waitState, type SlaState } from "./sla";
import { applyRouting, cleanRouting, escalateStale } from "./routing";
import { channelViews } from "./connect";
import { needHumanMap, type NeedHuman } from "./botqueue";
import { addAudit, auditConv, auditDenied } from "./audit";

const NO = { ok: false as const, error: "Bạn không có quyền với hội thoại này" };

export interface ConvListItem {
  id: string;
  channel: Pick<Channel, "id" | "name" | "kind">;
  contactName: string;
  contactAvatar?: string;
  lastText: string;
  lastDirection?: "in" | "out";
  lastMessageAt: number;
  status: ConvStatus;
  assigneeUid?: string;
  labels: string[];
  unread: boolean;
  waitingSince?: number; // khách nhắn mà chưa ai trả lời: thời điểm tin của khách
  sla?: { state: SlaState; limitMin: number }; // chỉ có khi kênh đã cài SLA
  stage?: string; // giai đoạn tư vấn (convmeta.ts)
  bot?: { id: string; name: string; mode: "auto" | "draft"; withStaff: boolean; state: "handling" | "suggesting" | "paused" }; // chatbot của hội thoại này và việc nó đang làm
  botState: BotState; // trạng thái chatbot: phụ trách, gợi ý, cần người, tạm dừng hoặc không có (botfilter.ts)
  hasPhone?: boolean; // khách đã để lại số điện thoại
  needHuman?: NeedHuman; // bot đã chuyển hoặc đề nghị chuyển người, chưa ai xử lý (hàng đợi cần người)
  snippet?: string; // khi tìm kiếm: đoạn tin có chữ cần tìm
}

export interface ListFilter {
  status?: string;
  channelId?: string;
  q?: string;
  assignee?: "me" | "none" | "all";
  actor: Actor; // người đang xem: quyết định thấy gì, chưa đọc, "của tôi"
}

const isUnread = (c: Conversation, uid: string) => !!c.lastInboundAt && !c.lastInboundHistory && (c.readBy?.[uid] ?? 0) < c.lastInboundAt;

export async function listConversations(store: Store, f: ListFilter) {
  const db = await store.load();
  const byConv = messagesByConv(db);
  // Tin cuối không phải ghi chú nội bộ (ghi chú không làm "tin cuối")
  const lastOf = (id: string) => { const arr = byConv.get(id) ?? []; for (let i = arr.length - 1; i >= 0; i--) if (!arr[i].internal) return arr[i]; return undefined; };
  // Tìm kiếm: theo tên, số điện thoại, nhãn và MỌI tin (searchConversations)
  const hits = f.q?.trim() ? new Map((await searchConversations(store, f.actor, f.q, 500)).map((h) => [h.id, h])) : null;
  const need = needHumanMap(db, Date.now());
  const bots = botHandlers(db, Date.now());
  const items: ConvListItem[] = [];
  for (const c of Object.values(db.conversations)) {
    // active: mọi trạng thái trừ đã xong
    if (f.status === "active" ? c.status === "resolved" : f.status && f.status !== "all" && c.status !== f.status) continue;
    if (hits && !hits.has(c.id)) continue;
    if (f.channelId && c.channelId !== f.channelId) continue;
    if (!canView(f.actor, c, db.channels[c.channelId])) continue;
    if (f.assignee === "me" && c.assigneeUid !== f.actor.uid) continue;
    if (f.assignee === "none" && c.assigneeUid) continue;
    const ch = db.channels[c.channelId];
    const ct = db.contacts[c.contactId];
    if (!ch || !ct) continue;
    const m = lastOf(c.id);
    items.push({
      id: c.id,
      channel: { id: ch.id, name: ch.name, kind: ch.kind },
      contactName: ct.name,
      contactAvatar: ct.avatarUrl,
      hasPhone: !!ct.phone,
      stage: c.stage,
      bot: bots.get(c.id),
      botState: need.has(c.id) ? "need" : bots.get(c.id)?.state ?? "none",
      lastText: m?.text || (m?.attachments.length ? "[tệp đính kèm]" : ""),
      lastDirection: m?.direction,
      lastMessageAt: c.lastMessageAt ?? 0,
      status: c.status,
      assigneeUid: c.assigneeUid,
      labels: c.labels,
      unread: isUnread(c, f.actor.uid),
      waitingSince: m?.direction === "in" && c.status !== "resolved" ? m.at : undefined,
      sla: m?.direction === "in" && c.status !== "resolved" ? (() => { const w = waitState(ch, c.assigneeUid, m.at, Date.now()); return w && { state: w.state, limitMin: w.limitMin }; })() : undefined,
      needHuman: need.get(c.id),
      ...(hits?.get(c.id)?.snippet ? { snippet: hits.get(c.id)!.snippet } : {}),
    });
  }
  // Cần người lên đầu (chờ lâu nhất trước), rồi chưa đọc, rồi theo thời gian
  return items.sort((a, b) => Number(!!b.needHuman) - Number(!!a.needHuman) || (a.needHuman && b.needHuman ? a.needHuman.since - b.needHuman.since : 0) || Number(b.unread) - Number(a.unread) || b.lastMessageAt - a.lastMessageAt);
}

// Tìm khách và nội dung tin (yêu cầu 3.1): theo tên khách, số điện thoại, nhãn và MỌI tin của hội thoại (kể cả ghi chú nội bộ).
// Không phân biệt dấu và hoa thường. Chỉ trả hội thoại người này được xem. Mỗi kết quả kèm một đoạn trích có chữ cần tìm.
export interface SearchHit { id: string; snippet?: string; at?: number }
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
const digits = (s: string) => s.replace(/\D/g, "");
export async function searchConversations(store: Store, actor: Actor, q: string, limit = 200): Promise<SearchHit[]> {
  const needle = fold(q.trim());
  if (needle.length < 2) return [];
  const phone = digits(q).length >= 4 ? digits(q) : "";
  const db = await store.load();
  const byConv = messagesByConv(db);
  const hits: SearchHit[] = [];
  for (const c of Object.values(db.conversations)) {
    if (!canView(actor, c, db.channels[c.channelId])) continue;
    const ct = db.contacts[c.contactId];
    if (!ct) continue;
    if (fold(ct.name).includes(needle) || (phone && digits(ct.phone ?? "").includes(phone)) || c.labels.some((l) => fold(l).includes(needle))) {
      hits.push({ id: c.id });
      continue;
    }
    const arr = byConv.get(c.id) ?? [];
    for (let i = arr.length - 1; i >= 0; i--) {
      const t = arr[i].text;
      const k = t ? fold(t).indexOf(needle) : -1;
      if (k < 0) continue;
      // Chữ dựng sẵn (NFC, như các kênh gửi) sau khi bỏ dấu giữ nguyên độ dài, nên vị trí tìm được dùng cắt đoạn trích trên chữ gốc
      const from = Math.max(0, k - 30);
      hits.push({ id: c.id, snippet: (from > 0 ? "…" : "") + t.slice(from, from + 90) + (from + 90 < t.length ? "…" : ""), at: arr[i].at });
      break;
    }
    if (hits.length >= limit) break;
  }
  return hits;
}

export async function unreadCount(store: Store, actor: Actor) {
  const db = await store.load();
  return Object.values(db.conversations).filter((c) => c.status !== "resolved" && canView(actor, c, db.channels[c.channelId]) && isUnread(c, actor.uid)).length;
}

export async function getThread(store: Store, id: string, actor: Actor) {
  const db = await store.load();
  const conversation = db.conversations[id];
  if (!conversation || !canView(actor, conversation, db.channels[conversation.channelId])) return null;
  const messages = messagesOf(db, id);
  return {
    conversation,
    contact: db.contacts[conversation.contactId],
    channel: db.channels[conversation.channelId],
    messages,
    profile: hostProfile(conversation, db.contacts[conversation.contactId]),
  };
}

export async function markRead(store: Store, id: string, actor: Actor, now = Date.now()) {
  return mutate(store, (db) => {
    const c = db.conversations[id];
    if (!c || !canView(actor, c, db.channels[c.channelId])) return false;
    (c.readBy ??= {})[actor.uid] = now;
    return true;
  });
}

export async function sendReply(
  store: Store,
  id: string,
  input: { text?: string; attachments?: Attachment[] },
  actor: Actor
) {
  const uid = actor.uid;
  const clean = (input.text ?? "").trim();
  const atts = input.attachments ?? [];
  if (!clean && !atts.length) return { ok: false as const, error: "Tin rỗng" };
  const db = await store.load();
  const conv = db.conversations[id];
  const ch = conv && db.channels[conv.channelId];
  const ct = conv && db.contacts[conv.contactId];
  if (!conv || !ch || !ct) return { ok: false as const, error: "Không thấy hội thoại" };
  if (!canAct(actor, conv, ch)) { await mutate(store, (d) => { auditDenied(d, actor, "gửi tin", id); }); return NO; }
  const since = conv.lastInboundAt ?? 0;
  const repliesSinceInbound = messagesOf(db, id).filter((m) => m.direction === "out" && !m.internal && m.at > since).length;
  const r = await sendMessage({
    channel: ch,
    contactExternalId: ct.externalId,
    conversationExternalId: conv.externalId,
    text: clean || undefined,
    attachments: atts,
    lastInboundAt: conv.lastInboundAt,
    repliesSinceInbound,
  });
  if (!r.ok && !r.parts?.length) return { ok: false as const, error: r.error ?? "Gửi lỗi" };
  // Ghi lại tin đã gửi (cả khi chỉ gửi được một phần). Mỗi phần lưu với đúng mã của kênh để echo về sau bị chặn trùng.
  const at = Date.now();
  const parts = r.parts?.length
    ? r.parts.map((p) => ({ externalId: p.externalId as string | undefined, text: p.text ?? "", attachments: p.attachment ? [p.attachment] : [] }))
    : [{ externalId: r.externalId, text: clean, attachments: atts }];
  await mutate(store, (d) => {
    const c = d.conversations[id];
    if (!c) return;
    parts.forEach((p, i) => recordSent(d, ch.id, c, p, uid, at + i));
    c.lastMessageAt = at;
    const nImg = atts.filter((a) => a.type === "image").length;
    if (nImg) auditConv(d, actor, "Gửi ảnh", id, `${nImg} ảnh`, at);
    if (clean || nImg < atts.length) auditConv(d, actor, "Gửi tin", id, undefined, at);
    if (!c.assigneeUid) { c.assigneeUid = uid; c.assignedAt = at; c.autoAssigned = false; }
    (c.readBy ??= {})[uid] = at;
  });
  return r.ok ? { ok: true as const } : { ok: false as const, error: r.error ?? "Gửi lỗi" };
}

// Lưu một tin nhân viên vừa gửi. Echo của chính tin này có thể đã về trước (Meta gửi echo rất nhanh, có khi trước cả lúc
// lời gọi gửi trả về): khi đó không tạo bản thứ hai, chỉ ghi thêm người gửi.
export function recordSent(d: DB, channelId: string, c: Conversation, p: { externalId?: string; text: string; attachments: Attachment[] }, uid: string | undefined, at: number) {
  const base = `${channelId}:${p.externalId ?? "out-" + at}`;
  const echoed = p.externalId ? d.messages[base] : undefined;
  if (echoed && echoed.conversationId === c.id) {
    if (uid) echoed.senderUid = uid;
    if (!echoed.text && p.text) echoed.text = p.text;
    return echoed;
  }
  const mid = d.messages[base] ? `${base}-${at}` : base;
  return (d.messages[mid] = {
    id: mid, companyId: c.companyId, conversationId: c.id, externalId: p.externalId ?? `out-${at}`,
    direction: "out", text: p.text, attachments: p.attachments, at, ...(uid ? { senderUid: uid } : {}),
  });
}

// Ghi chú nội bộ: lưu trong hội thoại, không gửi qua kênh.
export async function addNote(store: Store, id: string, text: string, actor: Actor) {
  const uid = actor.uid;
  const clean = text.trim();
  if (!clean) return { ok: false as const, error: "Ghi chú rỗng" };
  return mutate(store, (db) => {
    const c = db.conversations[id];
    if (!c) return { ok: false as const, error: "Không thấy hội thoại" };
    if (!canAct(actor, c, db.channels[c.channelId])) { auditDenied(db, actor, "ghi chú", id); return NO; }
    const at = Date.now();
    auditConv(db, actor, "Ghi chú nội bộ", id, undefined, at);
    const mid = `note:${id}:${at}:${Math.random().toString(36).slice(2, 6)}`;
    db.messages[mid] = { id: mid, companyId: c.companyId, conversationId: id, externalId: mid, direction: "out", text: clean, attachments: [], at, senderUid: uid, internal: true };
    return { ok: true as const };
  });
}

// Ghi một dòng vào lịch sử thao tác của hội thoại (giữ TASK_LIMITS.log dòng mới nhất)
const logTo = (db: DB, actor: Actor, c: Conversation, text: string, at = Date.now()) => {
  (c.log ??= []).push({ at, by: actor.uid, text });
  if (c.log.length > TASK_LIMITS.log) c.log.splice(0, c.log.length - TASK_LIMITS.log);
  auditConv(db, actor, text, c.id, undefined, at); // cùng một dòng cũng vào Nhật ký chung của quản trị
};
const statusName: Record<ConvStatus, string> = { open: "Đang mở", pending: "Chờ", snoozed: "Hoãn", resolved: "Đã xong" };
type Fail = { ok: false; error: string; code?: number };

export async function updateConversation(
  store: Store,
  id: string,
  patch: { status?: ConvStatus; assigneeUid?: string | null; labels?: string[]; stage?: string | null; lostReason?: string },
  actor: Actor
): Promise<{ ok: true } | Fail> {
  return mutate(store, (db): { ok: true } | Fail => {
    const c = db.conversations[id];
    if (!c) return { ok: false as const, error: "Không thấy hội thoại" };
    const chn = db.channels[c.channelId];
    if (!canAct(actor, c, chn)) { auditDenied(db, actor, "sửa hội thoại", id); return NO; }
    if (patch.assigneeUid !== undefined && !canAssign(actor, c, chn, patch.assigneeUid, DEMO_STAFF.find((s) => s.uid === patch.assigneeUid)?.role === "admin")) { auditDenied(db, actor, "giao hội thoại", id); return { ok: false as const, error: "Bạn không được giao hội thoại này cho người khác" }; }
    // Kiểm tra giai đoạn trước khi ghi bất cứ thứ gì
    let stage: ReturnType<typeof stageOf> | undefined;
    if (patch.stage) {
      stage = stageOf(patch.stage);
      if (!stage) return { ok: false, error: "Giai đoạn không hợp lệ", code: 400 };
      if (stage.core === "lost" && !LOST_REASONS.includes(patch.lostReason ?? "")) return { ok: false, error: "Chọn lý do mất đơn", code: 400 };
    }
    const at = Date.now();
    if (patch.status && patch.status !== c.status) { logTo(db, actor, c, `Đổi tình trạng: ${statusName[c.status]} → ${statusName[patch.status]}`, at); c.status = patch.status; }
    if (patch.assigneeUid !== undefined) {
      const old = c.assigneeUid;
      const name = (uid?: string) => (uid ? DEMO_STAFF.find((x) => x.uid === uid)?.name ?? uid : "chưa nhận");
      if ((patch.assigneeUid ?? undefined) !== old) logTo(db, actor, c, patch.assigneeUid ? (patch.assigneeUid === actor.uid ? "Nhận khách" : `Giao khách cho ${name(patch.assigneeUid)}`) : "Bỏ phụ trách", at);
      if (patch.assigneeUid && patch.assigneeUid !== c.assigneeUid) { c.assignedAt = Date.now(); c.autoAssigned = false; }
      if (!patch.assigneeUid && c.assigneeUid) c.lastAssigneeUid = c.assigneeUid;
      c.assigneeUid = patch.assigneeUid ?? undefined;
      if (!patch.assigneeUid) { c.assignedAt = undefined; c.autoAssigned = undefined; }
    }
    if (patch.labels) {
      const next = patch.labels.map((l) => l.trim()).filter(Boolean);
      const added = next.filter((l) => !c.labels.includes(l)), removed = c.labels.filter((l) => !next.includes(l));
      if (added.length) logTo(db, actor, c, `Gắn nhãn: ${added.join(", ")}`, at);
      if (removed.length) logTo(db, actor, c, `Bỏ nhãn: ${removed.join(", ")}`, at);
      c.labels = next;
    }
    if (patch.stage !== undefined) {
      const botBefore = pickBot(db, id, at)?.name; // chatbot trước khi đổi giai đoạn
      const from = stageOf(c.stage)?.name ?? "chưa có";
      if (!patch.stage) { if (c.stage) logTo(db, actor, c, `Bỏ giai đoạn CRM (trước đó: ${from})`, at); c.stage = undefined; c.stageAt = undefined; c.lostReason = undefined; }
      else if (patch.stage !== c.stage) {
        logTo(db, actor, c, `Đổi giai đoạn CRM: ${from} → ${stage!.name}${stage!.core === "lost" ? ` (${patch.lostReason})` : ""}`, at);
        c.stage = stage!.key; c.stageAt = at; c.lostReason = stage!.core === "lost" ? patch.lostReason : undefined;
      }
      const botAfter = pickBot(db, id, at)?.name;
      if (botBefore !== botAfter) logTo(db, actor, c, `Chatbot: ${botBefore ?? "chưa có"} → ${botAfter ?? "chưa có"} (theo giai đoạn CRM)`, at);
    }
    return { ok: true as const };
  });
}

// Sửa thông tin khách ở ô bên phải: số điện thoại, địa chỉ, phường/khu vực
export async function updateContactInfo(store: Store, id: string, input: { phone?: unknown; address?: unknown; area?: unknown }, actor: Actor): Promise<{ ok: true } | Fail> {
  const phone = String(input.phone ?? "").replace(/[\s.-]/g, "");
  const address = String(input.address ?? "").replace(/\s+/g, " ").trim();
  const area = String(input.area ?? "").replace(/\s+/g, " ").trim();
  if (phone && !/^\+?\d{8,15}$/.test(phone)) return { ok: false, error: "Số điện thoại không hợp lệ (8 đến 15 chữ số)", code: 400 };
  if (address.length > 200 || area.length > 80) return { ok: false, error: "Địa chỉ tối đa 200 ký tự, khu vực tối đa 80", code: 400 };
  return mutate(store, (db): { ok: true } | Fail => {
    const c = db.conversations[id];
    if (!c) return { ok: false, error: "Không thấy hội thoại" };
    if (!canAct(actor, c, db.channels[c.channelId])) { auditDenied(db, actor, "sửa thông tin khách", id); return NO; }
    const ct = db.contacts[c.contactId];
    if (!ct) return { ok: false, error: "Không thấy khách" };
    ct.phone = phone || undefined; ct.address = address || undefined; ct.area = area || undefined;
    logTo(db, actor, c, "Sửa thông tin khách");
    return { ok: true };
  });
}

// Việc cần làm của hội thoại: thêm, đánh dấu xong, xóa
export async function changeTask(store: Store, id: string, op: { add?: { text?: unknown; due?: unknown; time?: unknown; priority?: unknown; owner?: unknown; note?: unknown }; done?: { taskId: string; value: boolean }; remove?: string }, actor: Actor): Promise<{ ok: true } | Fail> {
  return mutate(store, (db): { ok: true } | Fail => {
    const c = db.conversations[id];
    if (!c) return { ok: false, error: "Không thấy hội thoại" };
    if (!canAct(actor, c, db.channels[c.channelId])) { auditDenied(db, actor, "việc cần làm", id); return NO; }
    const tasks = (c.tasks ??= []);
    const at = Date.now();
    if (op.add) {
      const text = String(op.add.text ?? "").replace(/\s+/g, " ").trim();
      const due = String(op.add.due ?? "").trim();
      if (!text) return { ok: false, error: "Nhập nội dung việc cần làm", code: 400 };
      if (text.length > TASK_LIMITS.text) return { ok: false, error: `Tối đa ${TASK_LIMITS.text} ký tự`, code: 400 };
      if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return { ok: false, error: "Ngày hạn không hợp lệ", code: 400 };
      if (tasks.length >= TASK_LIMITS.perConv) return { ok: false, error: `Mỗi hội thoại tối đa ${TASK_LIMITS.perConv} việc`, code: 400 };
      const time = String(op.add.time ?? "").trim();
      if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { ok: false, error: "Giờ không hợp lệ", code: 400 };
      const pr = String(op.add.priority ?? "").trim();
      if (pr && !["high", "med", "low"].includes(pr)) return { ok: false, error: "Mức ưu tiên không hợp lệ", code: 400 };
      const owner = String(op.add.owner ?? "").trim();
      if (owner && !DEMO_STAFF.some((x) => x.uid === owner)) return { ok: false, error: "Người thực hiện không hợp lệ", code: 400 };
      const note = String(op.add.note ?? "").replace(/\s+/g, " ").trim();
      if (note.length > TASK_LIMITS.note) return { ok: false, error: `Ghi chú tối đa ${TASK_LIMITS.note} ký tự`, code: 400 };
      tasks.push({ id: `t${at.toString(36)}${Math.random().toString(36).slice(2, 5)}`, text, due: due || undefined, time: time || undefined, priority: (pr || undefined) as TaskPriority | undefined, owner: owner || undefined, note: note || undefined, by: actor.uid, at });
      logTo(db, actor, c, `Thêm việc: ${text}`, at);
    } else if (op.done) {
      const t = tasks.find((x) => x.id === op.done!.taskId);
      if (!t) return { ok: false, error: "Không thấy việc này", code: 404 };
      t.done = op.done.value || undefined;
      logTo(db, actor, c, `${op.done.value ? "Xong việc" : "Mở lại việc"}: ${t.text}`, at);
    } else if (op.remove) {
      const i = tasks.findIndex((x) => x.id === op.remove);
      if (i < 0) return { ok: false, error: "Không thấy việc này", code: 404 };
      logTo(db, actor, c, `Xóa việc: ${tasks[i].text}`, at);
      tasks.splice(i, 1);
    } else return { ok: false, error: "Thiếu thao tác", code: 400 };
    return { ok: true };
  });
}

// Nhóm kênh của từng người: ai cũng tự xem và sửa nhóm của mình
export async function getChannelGroups(store: Store, uid: string): Promise<ChannelGroup[]> {
  return (await store.load()).channelGroups?.[uid] ?? [];
}
export async function setChannelGroups(store: Store, uid: string, input: unknown): Promise<{ ok: true; groups: ChannelGroup[] } | Fail> {
  return mutate(store, (db): { ok: true; groups: ChannelGroup[] } | Fail => {
    const r = cleanChannelGroups(input, Object.keys(db.channels));
    if (!r.ok) return { ...r, code: 400 };
    (db.channelGroups ??= {})[uid] = r.groups;
    return r;
  });
}

// Danh mục nhãn: ai cũng xem được, chỉ quản trị sửa
export async function getLabelCfg(store: Store): Promise<LabelCfg> {
  return (await store.load()).labelCfg ?? DEFAULT_LABEL_CFG;
}
export async function setLabelCfg(store: Store, input: unknown, actor: Actor): Promise<{ ok: true; cfg: LabelCfg } | Fail> {
  if (!isAdmin(actor)) return { ok: false, error: "Chỉ quản trị sửa được danh mục nhãn", code: 403 };
  const r = cleanLabelCfg(input);
  if (!r.ok) return { ...r, code: 400 };
  await mutate(store, (db) => { db.labelCfg = r.cfg; addAudit(db, actor, "Sửa danh mục nhãn", `${Object.keys(r.cfg.labels).length} nhãn`); });
  return r;
}

export async function listChannels(store: Store) {
  return Object.values((await store.load()).channels);
}

// Bật gửi tin chỉ được khi kênh đã kết nối (có token). Kênh mẫu "demo-" được miễn để thử giao diện.
export async function setChannelSend(store: Store, id: string, on: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  if (on && !id.startsWith("demo-")) {
    const v = (await channelViews(store)).find((c) => c.id === id);
    if (v && v.status !== "connected") return { ok: false, error: "Kênh chưa kết nối xong nên chưa bật gửi tin được" };
  }
  return mutate(store, (db) => {
    if (!db.channels[id]) return { ok: false as const, error: "Không thấy kênh" };
    db.channels[id].sendEnabled = on;
    return { ok: true as const };
  });
}

// Đổi tên hiển thị của kênh (nhất là khi nối nhiều số Zalo của nhiều nhân viên, cần tên dễ phân biệt).
export async function setChannelName(store: Store, id: string, name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const n = name.trim();
  if (!n) return { ok: false, error: "Tên kênh không được để trống" };
  if (n.length > 80) return { ok: false, error: "Tên kênh dài tối đa 80 ký tự" };
  return mutate(store, (db) => {
    if (!db.channels[id]) return { ok: false as const, error: "Không thấy kênh" };
    db.channels[id].name = n;
    return { ok: true as const };
  });
}

// Dữ liệu mẫu để xem giao diện khi chưa nối kênh thật. Chạy lại không tạo trùng.
export async function seedDemo(store: Store) {
  return mutate(store, (db) => {
    if (db.channels["demo-fb"]) return { seeded: false };
    const co = "demo";
    const now = Date.now();
    const min = 60_000;
    db.channels["demo-fb"] = { id: "demo-fb", companyId: co, kind: "facebook", externalId: "PAGE_DEMO", name: "Fanpage demo", sendEnabled: false, access: { lan: "send", hai: "send" } };
    db.channels["demo-ig"] = { id: "demo-ig", companyId: co, kind: "instagram", externalId: "IG_DEMO", name: "Instagram demo", sendEnabled: false, meta: { pageId: "PAGE_DEMO" }, access: { lan: "send", hai: "view" } };
    const people: Array<[string, string, string, Array<["in" | "out", string, number]>]> = [
      ["demo-fb", "u1", "Nguyễn Minh Anh", [["in", "Chào shop, tour Đà Nẵng 3 ngày 2 đêm giá bao nhiêu ạ?", 42], ["out", "Dạ chào chị, tour Đà Nẵng hiện từ 3.290.000đ/khách ạ.", 40], ["in", "Có bao gồm vé máy bay không em?", 3]]],
      ["demo-fb", "u2", "Trần Quốc Bảo", [["in", "Mình muốn đặt 4 hộp quà Tết, giao Quận 7", 130]]],
      ["demo-ig", "u3", "lan.pham.studio", [["in", "Cho mình xin báo giá combo nhé", 600], ["out", "Dạ shop gửi chị báo giá qua tin nhắn ạ.", 590]]],
      ["demo-fb", "u4", "Lê Hoài Thu", [["in", "Cảm ơn shop nhiều nha", 2000]]],
    ];
    for (const [chId, uid, name, msgs] of people) {
      const cid = `${chId}:${uid}`, convId = `${chId}:conv:${uid}`;
      db.contacts[cid] = { id: cid, companyId: co, channelId: chId, externalId: uid, name };
      const conv: Conversation = { id: convId, companyId: co, channelId: chId, contactId: cid, status: uid === "u4" ? "resolved" : "open", labels: uid === "u1" ? ["Tour"] : [], assigneeUid: uid === "u1" ? "lan" : uid === "u2" ? "hai" : undefined, assignedAt: uid === "u1" || uid === "u2" ? now - 30 * min : undefined };
      db.conversations[convId] = conv;
      msgs.forEach(([dir, text, ago], i) => {
        const at = now - ago * min;
        const mid = `${chId}:${uid}-${i}`;
        db.messages[mid] = { id: mid, companyId: co, conversationId: convId, externalId: `${uid}-${i}`, direction: dir, text, attachments: [], at };
        conv.lastMessageAt = Math.max(conv.lastMessageAt ?? 0, at);
        if (dir === "in") conv.lastInboundAt = Math.max(conv.lastInboundAt ?? 0, at);
      });
    }
    db.templates = {
      "tpl-chao": { id: "tpl-chao", key: "chao", order: 1, blocks: [{ text: "Dạ chào {ten_khach}, em {ten_nhan_vien} xin hỗ trợ mình ạ. Mình cần tư vấn nội dung nào ạ?", images: [] }] },
      "tpl-cam-on": { id: "tpl-cam-on", key: "camon", order: 2, blocks: [{ text: "Dạ em cảm ơn {ten_khach} đã quan tâm.", images: [] }, { text: "Cần hỗ trợ thêm mình nhắn em nhé ạ!", images: [] }] },
    };
    return { seeded: true };
  });
}

// ---------- Phân quyền theo kênh (quản trị) ----------
export async function setChannelAccess(store: Store, id: string, access: Record<string, "send" | "view">, staffUids: string[]) {
  const clean: Record<string, "send" | "view"> = {};
  for (const [uid, lv] of Object.entries(access)) {
    if (!staffUids.includes(uid)) return { ok: false as const, error: `Người dùng "${uid}" không hợp lệ` };
    if (lv !== "send" && lv !== "view") return { ok: false as const, error: "Mức quyền không hợp lệ" };
    clean[uid] = lv;
  }
  return mutate(store, (db) => {
    const ch = db.channels[id];
    if (!ch) return { ok: false as const, error: "Không thấy kênh" };
    ch.access = clean;
    // Người không còn mức Nhắn tin thì bỏ phụ trách các hội thoại đang mở của kênh này để hội thoại không bị kẹt.
    for (const c of Object.values(db.conversations)) {
      if (c.channelId === id && c.assigneeUid && c.status !== "resolved" && clean[c.assigneeUid] !== "send" && !DEMO_STAFF.some((s) => s.uid === c.assigneeUid && s.role === "admin")) { c.lastAssigneeUid = c.assigneeUid; c.assigneeUid = undefined; c.assignedAt = undefined; c.autoAssigned = undefined; }
    }
    return { ok: true as const };
  });
}

// ---------- SLA theo kênh (quản trị) ----------
export async function setChannelSla(store: Store, id: string, input: unknown | null, agentUids: string[]) {
  if (input === null) {
    return mutate(store, (db) => {
      if (!db.channels[id]) return { ok: false as const, error: "Không thấy kênh" };
      db.channels[id].sla = undefined; // gỡ SLA: kênh không còn đo
      return { ok: true as const };
    });
  }
  const c = cleanSla(input, agentUids);
  if (!c.ok) return c;
  return mutate(store, (db) => {
    if (!db.channels[id]) return { ok: false as const, error: "Không thấy kênh" };
    db.channels[id].sla = c.sla;
    return { ok: true as const };
  });
}

// ---------- Chia khách (quản trị) ----------
const AGENT_UIDS = DEMO_STAFF.filter((s) => s.role === "agent").map((s) => s.uid);

export async function setChannelRouting(store: Store, id: string, input: unknown | null) {
  return mutate(store, (db) => {
    const ch = db.channels[id];
    if (!ch) return { ok: false as const, error: "Không thấy kênh" };
    if (input === null) { ch.routing = undefined; return { ok: true as const }; }
    const withSend = AGENT_UIDS.filter((u) => ch.access?.[u] === "send");
    const c = cleanRouting(input, withSend);
    if (!c.ok) return c;
    // giữ vị trí xoay vòng cũ nếu chế độ không đổi
    if (ch.routing?.mode === c.routing.mode && c.routing.cursor === undefined) c.routing.cursor = ch.routing.cursor;
    ch.routing = c.routing;
    return { ok: true as const };
  });
}

// Chia lại các hội thoại đang mở mà chưa có người nhận (dùng sau khi đổi cấu hình hoặc khi có người quay lại làm việc).
export async function routeUnassigned(store: Store, channelId: string, now = Date.now()) {
  return mutate(store, (db) => {
    const ch = db.channels[channelId];
    if (!ch?.routing || ch.routing.mode === "manual") return { ok: false as const, error: "Kênh này chưa bật chia khách tự động" };
    const waiting = Object.values(db.conversations)
      .filter((c) => c.channelId === channelId && !c.assigneeUid && c.status !== "resolved")
      .sort((a, b) => (a.lastInboundAt ?? 0) - (b.lastInboundAt ?? 0)); // khách chờ lâu nhất được chia trước
    let n = 0;
    for (const c of waiting) if (applyRouting(db, c, AGENT_UIDS, now)) n++;
    return { ok: true as const, assigned: n, left: waiting.length - n };
  });
}

// Tạm nghỉ hoặc nhận lại khách tự động. Nhân viên đổi cho chính mình; quản trị đổi cho bất kỳ ai.
export async function setAway(store: Store, actor: Actor, uid: string, away: boolean) {
  if (actor.uid !== uid && actor.role !== "admin") return { ok: false as const, error: "Bạn chỉ đổi được trạng thái của chính mình" };
  if (!AGENT_UIDS.includes(uid)) return { ok: false as const, error: "Không phải nhân viên" };
  return mutate(store, (db) => {
    (db.away ??= {})[uid] = away;
    if (!away) delete db.away[uid];
    return { ok: true as const };
  });
}

// Chạy chuyển tiếp khách chờ quá lâu. Gọi mỗi khi giao diện tải danh sách; chỉ ghi khi có kênh bật chuyển tiếp.
export async function runEscalations(store: Store, now = Date.now()) {
  const db = await store.load();
  if (!Object.values(db.channels).some((c) => c.routing?.escalateMin)) return 0;
  return mutate(store, (d) => escalateStale(d, AGENT_UIDS, now));
}

// Ghi nhận nhân viên đang mở KP Chat (để biết ai trực tuyến). Bỏ qua nếu vừa ghi gần đây để đỡ ghi kho.
export async function touchSeen(store: Store, uid: string, now = Date.now()) {
  const db = await store.load();
  if (now - (db.seen?.[uid] ?? 0) < 30_000) return;
  await mutate(store, (d) => { (d.seen ??= {})[uid] = now; });
}
