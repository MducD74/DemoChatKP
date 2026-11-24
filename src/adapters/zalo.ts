// Adapter Zalo OA. Đã đối chiếu tài liệu developers.zalo.me: webhook tin nhắn người dùng, chữ ký X-ZEvent-Signature,
// gửi tin Tư vấn (openapi.zalo.me/v3.0/oa/message/cs), OAuth (access 25 giờ, refresh 3 tháng dùng một lần).
// Chưa thử với OA thật. Các điểm chưa kiểm được ghi chú "CHƯA XÁC MINH" bên dưới.
import { createHash, timingSafeEqual } from "node:crypto";
import type { ChannelAdapter, SendInput, SendResult } from "@/core/adapter";
import type { Attachment, InboundEvent } from "@/core/types";
import type { ChannelTokens, TokenStore } from "@/core/token-store";

export interface ZaloConfig {
  appId: string;
  appSecret: string; // secret key của ứng dụng: dùng cho chữ ký webhook và làm header secret_key khi đổi token
  tokens: TokenStore;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const OAUTH_URL = "https://oauth.zaloapp.com/v4/oa/access_token";
const SEND_URL = "https://openapi.zalo.me/v3.0/oa/message/cs";
const USER_URL = "https://openapi.zalo.me/v3.0/oa/user/detail"; // GET ?data={"user_id":"..."}, header access_token
const SKEW_MS = 10 * 60 * 1000; // làm mới token khi còn dưới 10 phút

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

interface RawAttachment { type: string; payload?: { url?: string; name?: string; coordinates?: { latitude: string; longitude: string } } }
interface RawEvent {
  app_id?: string;
  event_name?: string;
  sender?: { id: string };
  recipient?: { id: string };
  message?: { text?: string; msg_id?: string; attachments?: RawAttachment[] };
  timestamp?: string;
}

const mapAtt = (a: RawAttachment): Attachment | null => {
  const url = a.payload?.url;
  switch (a.type) {
    case "image": case "gif": return url ? { type: "image", url } : null;
    case "audio": return url ? { type: "audio", url } : null;
    case "video": return url ? { type: "video", url } : null;
    case "file": return url ? { type: "file", url, name: a.payload?.name } : null;
    case "sticker": return url ? { type: "sticker", url } : null;
    case "link": return url ? { type: "other", url } : null;
    default: return null;
  }
};

export function createZaloAdapter(cfg: ZaloConfig) {
  const doFetch = cfg.fetchImpl ?? fetch;
  const now = cfg.now ?? Date.now;
  // Refresh token chỉ dùng một lần: mỗi kênh chỉ được làm mới một lượt tại một thời điểm.
  const inflight = new Map<string, Promise<ChannelTokens | null>>();

  async function oauth(params: Record<string, string>): Promise<ChannelTokens | null> {
    const res = await doFetch(OAUTH_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", secret_key: cfg.appSecret },
      body: new URLSearchParams({ app_id: cfg.appId, ...params }).toString(),
    });
    const j = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: string | number };
    if (!j.access_token || !j.refresh_token) return null;
    const t = now();
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      accessExpiresAt: t + Number(j.expires_in ?? 90000) * 1000,
      refreshExpiresAt: t + 90 * 24 * 3600 * 1000, // 3 tháng
    };
  }

  function refresh(channelId: string): Promise<ChannelTokens | null> {
    const running = inflight.get(channelId);
    if (running) return running;
    const p = (async () => {
      const cur = await cfg.tokens.get(channelId);
      if (!cur || cur.refreshExpiresAt <= now()) return null; // hết hạn: phải cấp quyền lại
      const next = await oauth({ grant_type: "refresh_token", refresh_token: cur.refreshToken });
      if (next) await cfg.tokens.save(channelId, next); // lưu ngay: refresh token cũ đã hết tác dụng
      return next;
    })().finally(() => inflight.delete(channelId));
    inflight.set(channelId, p);
    return p;
  }

  async function validToken(channelId: string): Promise<string | null> {
    const cur = await cfg.tokens.get(channelId);
    if (!cur) return null;
    if (cur.accessExpiresAt - now() > SKEW_MS) return cur.accessToken;
    return (await refresh(channelId))?.accessToken ?? null;
  }

  // Cấp quyền lần đầu: đổi authorization code (hiệu lực 10 phút, dùng một lần) lấy cặp token.
  // CHƯA XÁC MINH: tên tham số PKCE (code_verifier) theo tài liệu hiện hành.
  async function connect(channelId: string, code: string, codeVerifier?: string): Promise<boolean> {
    const t = await oauth({ grant_type: "authorization_code", code, ...(codeVerifier ? { code_verifier: codeVerifier } : {}) });
    if (!t) return false;
    await cfg.tokens.save(channelId, t);
    return true;
  }

  async function post(token: string, body: object) {
    const res = await doFetch(SEND_URL, {
      method: "POST",
      headers: { "content-type": "application/json", access_token: token },
      body: JSON.stringify(body),
    });
    return (await res.json().catch(() => ({}))) as { error?: number; message?: string; data?: { message_id?: string } };
  }

  // CHƯA XÁC MINH: mã lỗi token hết hạn. Tạm coi mọi lỗi có chữ "token" là cần làm mới rồi thử lại một lần.
  const isTokenError = (j: { error?: number; message?: string }) => !!j.error && /token/i.test(j.message ?? "");

  // Tên và ảnh người dùng: GET user/detail. Chỉ lấy được người đã quan tâm OA hoặc đã tương tác (lỗi thì trả null, lần sau thử lại theo cơ chế của lõi).
  // CHƯA XÁC MINH với OA thật: tên trường (display_name, user_alias, avatar, avatars["240"]) lấy từ SDK cộng đồng, chưa đọc được trang tài liệu chính thức (trang dựng bằng JS).
  async function getUser(token: string, uid: string) {
    const res = await doFetch(`${USER_URL}?${new URLSearchParams({ data: JSON.stringify({ user_id: uid }) })}`, { method: "GET", headers: { access_token: token } });
    return (await res.json().catch(() => ({}))) as { error?: number; message?: string; data?: { display_name?: string; user_alias?: string; avatar?: string; avatars?: Record<string, string> } };
  }

  const adapter: ChannelAdapter = {
    id: "zalo_oa",
    // Tin Tư vấn: người dùng phải tương tác với OA trong 7 ngày. Trong 48 giờ gửi miễn phí; quá 48 giờ có thể tính hạn mức.
    replyWindowMs: 7 * 24 * 3600 * 1000,
    verify(headers, rawBody) {
      const sig = (headers.get("x-zevent-signature") ?? "").replace(/^mac=/i, "").trim().toLowerCase();
      if (!sig) return false;
      let ts: string | undefined;
      try {
        ts = (JSON.parse(rawBody) as RawEvent).timestamp;
      } catch {
        return false;
      }
      if (!ts) return false;
      // mac = sha256(appId + data + timeStamp + OAsecretKey), data là chuỗi JSON nhận được
      return safeEq(sig, sha256(cfg.appId + rawBody + ts + cfg.appSecret));
    },
    parse(payload): InboundEvent[] {
      const e = payload as RawEvent;
      if (!e?.event_name?.startsWith("user_send_")) return []; // các sự kiện khác chưa xử lý
      if (e.app_id && e.app_id !== cfg.appId) return [];
      const oa = e.recipient?.id, user = e.sender?.id, msg = e.message;
      if (!oa || !user || !msg?.msg_id) return [];
      const atts = (msg.attachments ?? []).map(mapAtt).filter((a): a is Attachment => !!a);
      let text = msg.text ?? "";
      const loc = msg.attachments?.find((a) => a.type === "location")?.payload?.coordinates;
      if (loc) text = `[Vị trí] ${loc.latitude}, ${loc.longitude}`;
      return [{
        channelExternalId: oa,
        contact: { externalId: user }, // tên và ảnh lấy sau qua fetchProfile (user/detail)
        message: { externalId: msg.msg_id, direction: "in", text, attachments: atts, at: Number(e.timestamp) || now() },
      }];
    },
    async send({ channel, contactExternalId, text, attachments }: SendInput): Promise<SendResult> {
      const bodies: object[] = [];
      const to = { user_id: contactExternalId };
      if (text) bodies.push({ recipient: to, message: { text } });
      for (const a of attachments ?? []) {
        if (a.type !== "image") return { ok: false, error: `Chưa hỗ trợ gửi tệp loại ${a.type}` };
        // Ảnh jpg/png, tối đa 1MB, một ảnh mỗi tin.
        bodies.push({ recipient: to, message: { attachment: { type: "template", payload: { template_type: "media", elements: [{ media_type: "image", url: a.url }] } } } });
      }
      if (!bodies.length) return { ok: false, error: "Tin rỗng" };
      let token = await validToken(channel.id);
      if (!token) return { ok: false, error: "Chưa cấp quyền hoặc token Zalo OA đã hết hạn, cần kết nối lại" };
      let last: string | undefined;
      for (const body of bodies) {
        let j = await post(token, body);
        if (isTokenError(j)) {
          const t = await refresh(channel.id);
          if (!t) return { ok: false, error: "Token Zalo OA hết hạn, cần kết nối lại" };
          token = t.accessToken;
          j = await post(token, body);
        }
        if (j.error !== 0) return { ok: false, error: `Zalo ${j.error ?? "?"}: ${j.message ?? "lỗi"}` };
        last = j.data?.message_id;
      }
      return { ok: true, externalId: last };
    },
    async fetchProfile(channel, uid) {
      let token = await validToken(channel.id);
      if (!token) return null;
      let j = await getUser(token, uid).catch(() => null);
      if (j && isTokenError(j)) {
        token = (await refresh(channel.id))?.accessToken ?? null;
        j = token ? await getUser(token, uid).catch(() => null) : null;
      }
      if (!j || j.error !== 0 || !j.data) return null;
      const name = (j.data.display_name || j.data.user_alias)?.trim();
      const avatarUrl = j.data.avatars?.["240"] || j.data.avatar || undefined;
      return name || avatarUrl ? { name: name || undefined, avatarUrl } : null;
    },
    async refreshToken(channel) {
      await refresh(channel.id);
    },
  };
  return Object.assign(adapter, { connect });
}
