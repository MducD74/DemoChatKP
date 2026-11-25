// Adapter Meta: Messenger (object "page") và Instagram (object "instagram"), nối thẳng.
// Đã đối chiếu tài liệu Meta (webhooks, send-messages, instagram-messaging). Chưa thử với app/page thật.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ChannelAdapter, SendInput, SendResult } from "@/core/adapter";
import type { Attachment, InboundEvent } from "@/core/types";
import { HUMAN_AGENT_TAG, HUMAN_AGENT_WINDOW_MS } from "@/core/metahuman";

export interface MetaConfig {
  kind: "facebook" | "instagram";
  appSecret: string;
  verifyToken: string;
  // Lấy token trang (đã giải mã) theo kênh. Token không nằm trong mã hay log.
  getToken: (channel: SendInput["channel"]) => Promise<string | null>;
  graphVersion?: string; // mặc định v27.0 (theo tài liệu hiện tại)
  fetchImpl?: typeof fetch; // để test
  // Công tắc Human Agent (trả lời quá 24 giờ, tối đa 7 ngày). Hàm để đọc lại mỗi lần gửi. Mặc định tắt: chỉ bật khi Meta đã duyệt quyền Human Agent.
  humanAgent?: () => boolean;
}

const hmac = (secret: string, body: string) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

// Meta ký trên dạng đã escape unicode (ký tự ngoài ASCII thành \uXXXX, hex thường).
const escapeUnicode = (s: string) =>
  s.replace(/[\u0080-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const mapType = (t: string): Attachment["type"] =>
  t === "image" || t === "audio" || t === "video" || t === "file" ? t
  : t === "reel" || t === "ig_reel" ? "video" : "other";

interface RawMsg {
  mid?: string;
  text?: string;
  is_echo?: boolean;
  is_deleted?: boolean;
  is_self?: boolean; // Instagram: tin thử gửi cho chính tài khoản
  is_unsupported?: boolean; // Instagram: loại tin Meta không chuyển được (ví dụ gif, sticker)
  attachments?: Array<{ type: string; payload?: { url?: string } }>;
}
interface RawMessaging {
  sender?: { id: string };
  recipient?: { id: string };
  timestamp?: number;
  message?: RawMsg;
}

// Lỗi gửi của Meta thành câu dễ hiểu; luôn giữ mã và nguyên văn của Meta để tra cứu.
function metaSendError(status: number, e: { message?: string; code?: number; error_subcode?: number } | undefined, tagged: boolean): string {
  const raw = `Meta ${e?.code ?? status}${e?.error_subcode ? `/${e.error_subcode}` : ""}: ${e?.message ?? "lỗi"}`;
  if (e?.code === 190) return `${raw}. Token Page hết hạn hoặc bị thu hồi: vào Cài đặt > Kênh, bấm Kết nối lại.`;
  if (tagged && (e?.code === 10 || e?.code === 200 || e?.code === 100)) return `${raw}. Thẻ Human Agent bị từ chối: app có thể chưa được Meta duyệt quyền Human Agent. Tắt META_HUMAN_AGENT cho tới khi được duyệt.`;
  if (!tagged && e?.code === 10) return `${raw}. Có thể đã quá 24 giờ kể từ tin cuối của khách.`;
  return raw;
}

export function createMetaAdapter(cfg: MetaConfig): ChannelAdapter {
  const object = cfg.kind === "instagram" ? "instagram" : "page";
  const version = cfg.graphVersion ?? "v27.0";
  const doFetch = cfg.fetchImpl ?? fetch;

  return {
    id: cfg.kind,
    replyWindowMs: 24 * 3600 * 1000, // cửa sổ chuẩn 24 giờ kể từ tin cuối của khách
    // Cửa sổ mở rộng cho nhân viên thật (thẻ Human Agent, 7 ngày): chỉ khi công tắc bật. Chatbot không dùng được (xem send.ts, chatbot.ts).
    extendedWindowMs: () => (cfg.humanAgent?.() ? HUMAN_AGENT_WINDOW_MS : null),
    verify(headers, rawBody) {
      const sig = headers.get("x-hub-signature-256");
      if (!sig) return false;
      return safeEq(sig, hmac(cfg.appSecret, rawBody)) || safeEq(sig, hmac(cfg.appSecret, escapeUnicode(rawBody)));
    },
    challenge(params) {
      if (params.get("hub.mode") === "subscribe" && params.get("hub.verify_token") === cfg.verifyToken) {
        return params.get("hub.challenge") ?? "";
      }
      return null;
    },
    parse(payload): InboundEvent[] {
      const p = payload as { object?: string; entry?: Array<{ id: string; messaging?: RawMessaging[] }> };
      if (p?.object !== object || !Array.isArray(p.entry)) return [];
      const out: InboundEvent[] = [];
      for (const entry of p.entry) {
        for (const m of entry.messaging ?? []) {
          const msg = m.message;
          if (!msg?.mid || msg.is_deleted) continue; // bỏ postback, đã đọc, đã nhận...
          if (msg.is_self) continue; // Instagram: tin thử gửi cho chính tài khoản, không phải khách
          const echo = msg.is_echo === true;
          // Tin echo: do trang gửi, khách là recipient.
          const customer = echo ? m.recipient?.id : m.sender?.id;
          if (!customer) continue;
          out.push({
            channelExternalId: entry.id,
            contact: { externalId: customer },
            message: {
              externalId: msg.mid,
              direction: echo ? "out" : "in",
              text: msg.text || (msg.is_unsupported && !msg.attachments?.length ? "[Tin nhắn Instagram chưa hiển thị được]" : ""),
              attachments: (msg.attachments ?? [])
                .filter((a) => a.payload?.url)
                .map((a) => ({ type: mapType(a.type), url: a.payload!.url! })),
              at: m.timestamp ?? Date.now(),
            },
          });
        }
      }
      return out;
    },
    // Hồ sơ khách (Messenger: PSID, Instagram: IGSID). Meta chỉ trả khi khách đã nhắn cho trang; lỗi thì trả null, không làm hỏng việc nhận tin.
    async fetchProfile(channel, contactExternalId) {
      try {
        const token = await cfg.getToken(channel);
        if (!token) return { error: "Kênh chưa có token" };
        const fields = cfg.kind === "instagram" ? "name,username,profile_pic" : "name,profile_pic";
        const res = await doFetch(`https://graph.facebook.com/${version}/${encodeURIComponent(contactExternalId)}?fields=${fields}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        const j = (await res.json().catch(() => ({}))) as { name?: string; username?: string; profile_pic?: string; error?: { message?: string; code?: number } };
        if (!res.ok) {
          // Không ghi mã khách hay nội dung: chỉ lỗi của Meta, để biết vì sao không có tên và ảnh
          const error = `Meta không trả hồ sơ khách${j.error?.code ? ` (#${j.error.code})` : ` (${res.status})`}: ${j.error?.message ?? "không rõ lý do"}`;
          console.warn(`[ho-so:${cfg.kind}] ${error}`);
          return { error };
        }
        const name = (j.name ?? j.username)?.trim();
        if (!name && !j.profile_pic) return { error: "Meta trả hồ sơ rỗng (không có tên và ảnh)" };
        return { name: name || undefined, avatarUrl: j.profile_pic };
      } catch (e) {
        return { error: `Không gọi được Meta: ${e instanceof Error ? e.message : "lỗi mạng"}` };
      }
    },
    async send({ channel, contactExternalId, text, attachments, messageTag, lastInboundAt, now }: SendInput): Promise<SendResult> {
      // Thẻ Human Agent: chỉ khi công tắc đang bật và tin cuối của khách chưa quá 7 ngày (adapter tự kiểm lại, không tin hoàn toàn vào nơi gọi).
      if (messageTag && (messageTag !== HUMAN_AGENT_TAG || !cfg.humanAgent?.())) return { ok: false, error: "Human Agent đang tắt" };
      if (messageTag && (!lastInboundAt || (now ?? Date.now()) - lastInboundAt > HUMAN_AGENT_WINDOW_MS)) return { ok: false, error: "Quá 7 ngày kể từ tin cuối của khách: không thể nhắn thêm" };
      const token = await cfg.getToken(channel);
      if (!token) return { ok: false, error: "Thiếu token trang" };
      // Instagram liên kết Page gửi qua /{PAGE_ID}/messages; externalId của kênh Instagram là id tài khoản IG nhận webhook.
      const url = `https://graph.facebook.com/${version}/${channel.meta?.pageId ?? channel.externalId}/messages`;
      // Chữ và ảnh gửi thành các tin riêng.
      const bodies: object[] = [];
      const kinds: Array<{ text?: string; attachment?: Attachment }> = [];
      if (text) { bodies.push({ text }); kinds.push({ text }); }
      for (const a of attachments ?? []) {
        if (a.type === "image") { bodies.push({ attachment: { type: "image", payload: { url: a.url } } }); kinds.push({ attachment: a }); }
        else return { ok: false, error: `Chưa hỗ trợ gửi tệp loại ${a.type}` };
      }
      if (!bodies.length) return { ok: false, error: "Tin rỗng" };
      let last: string | undefined;
      const parts: NonNullable<SendResult["parts"]> = [];
      for (const [i, message] of bodies.entries()) {
        const res = await doFetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          // Trong 24 giờ: RESPONSE. Quá 24 giờ (Human Agent): MESSAGE_TAG kèm tag HUMAN_AGENT. CHƯA XÁC MINH dạng này với Meta (xem metahuman.ts).
          body: JSON.stringify({ recipient: { id: contactExternalId }, ...(messageTag ? { messaging_type: "MESSAGE_TAG", tag: messageTag } : { messaging_type: "RESPONSE" }), message }),
        });
        const j = (await res.json().catch(() => ({}))) as { message_id?: string; error?: { message?: string; code?: number } };
        if (!res.ok) {
          const error = metaSendError(res.status, j.error, !!messageTag);
          // Đã gửi được một phần: báo rõ để nhân viên không gửi lại cả tin (khách sẽ nhận trùng)
          return { ok: false, error: parts.length ? `Đã gửi ${parts.length}/${bodies.length} phần, phần còn lại lỗi: ${error}` : error, ...(parts.length ? { parts } : {}) };
        }
        last = j.message_id;
        if (j.message_id) parts.push({ externalId: j.message_id, ...kinds[i] });
      }
      return { ok: true, externalId: last, ...(parts.length > 1 ? { parts } : {}) };
    },
  };
}
