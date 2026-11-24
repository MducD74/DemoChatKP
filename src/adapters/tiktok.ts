// Adapter TikTok Business Messaging API (open beta; cần được TikTok duyệt quyền truy cập).
// Đã đối chiếu tài liệu business-api.tiktok.com (v1.3): webhook im_receive_msg/im_send_msg, chữ ký Tiktok-Signature,
// gửi tin /business/message/send/, tải ảnh lên, OAuth (access 1 ngày, refresh 1 năm). Chưa thử với tài khoản thật.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ChannelAdapter, SendInput, SendResult } from "@/core/adapter";
import type { Attachment, InboundEvent } from "@/core/types";
import type { ChannelTokens, TokenStore } from "@/core/token-store";

export interface TikTokConfig {
  clientKey: string; // App ID của developer app
  clientSecret: string; // Secret: ký webhook và đổi/làm mới token
  tokens: TokenStore;
  fetchImpl?: typeof fetch;
  now?: () => number;
  webhookToleranceSec?: number; // chống phát lại, mặc định 300 giây
}

const BASE = "https://business-api.tiktok.com/open_api/v1.3";
const SKEW_MS = 10 * 60 * 1000;
const MAX_IMAGE = 3 * 1024 * 1024; // 3MB, jpg/png

const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const hmac = (secret: string, s: string) => createHmac("sha256", secret).update(s).digest("hex");

interface Api<T = unknown> { code?: number; message?: string; data?: T }

// Ảnh nhận về chỉ có media_id; lưu tham chiếu này, cần gọi resolveMedia để lấy link tải (24 giờ).
export const tiktokMediaRef = (conv: string, msg: string, media: string) => `tiktok-media://${conv}/${msg}/${media}`;
export function parseTikTokMediaRef(url: string) {
  const m = /^tiktok-media:\/\/([^/]+)\/([^/]+)\/(.+)$/.exec(url);
  return m ? { conversationId: m[1], messageId: m[2], mediaId: m[3] } : null;
}

interface RawContent {
  from?: string;
  to?: string;
  from_user?: { id: string; role: string };
  to_user?: { id: string; role: string };
  conversation_id?: string;
  message_id?: string;
  timestamp?: number;
  type?: string;
  text?: { body?: string };
  image?: { media_id?: string };
  share_post?: { embed_url?: string; video_id?: string };
}
interface RawEvent { client_key?: string; event?: string; create_time?: number; user_openid?: string; content?: string }

export function createTikTokAdapter(cfg: TikTokConfig) {
  const doFetch = cfg.fetchImpl ?? fetch;
  const now = cfg.now ?? Date.now;
  const tolerance = cfg.webhookToleranceSec ?? 300;
  const inflight = new Map<string, Promise<ChannelTokens | null>>();

  async function oauth(path: string, params: Record<string, string>) {
    const res = await doFetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: cfg.clientKey, client_secret: cfg.clientSecret, ...params }),
    });
    const j = (await res.json().catch(() => ({}))) as Api<{
      access_token?: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number; open_id?: string;
    }>;
    if (j.code !== 0 || !j.data?.access_token) return null;
    return j.data;
  }

  function refresh(channelId: string): Promise<ChannelTokens | null> {
    const running = inflight.get(channelId);
    if (running) return running;
    const p = (async () => {
      const cur = await cfg.tokens.get(channelId);
      if (!cur || cur.refreshExpiresAt <= now()) return null; // hết hạn 1 năm: phải cấp quyền lại
      const d = await oauth("/tt_user/oauth2/refresh_token/", { grant_type: "refresh_token", refresh_token: cur.refreshToken });
      if (!d) return null;
      const t = now();
      const next: ChannelTokens = {
        accessToken: d.access_token!,
        // Nếu TikTok trả refresh token mới thì dùng, không thì giữ cái cũ.
        refreshToken: d.refresh_token ?? cur.refreshToken,
        accessExpiresAt: t + (d.expires_in ?? 86400) * 1000,
        refreshExpiresAt: d.refresh_token ? t + (d.refresh_token_expires_in ?? 31536000) * 1000 : cur.refreshExpiresAt,
      };
      await cfg.tokens.save(channelId, next);
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

  // Cấp quyền lần đầu: đổi auth_code (10 phút, một lần) lấy token. Trả open_id: dùng làm externalId (business_id) của kênh.
  async function connect(channelId: string, authCode: string, redirectUri: string): Promise<{ openId: string } | null> {
    const d = await oauth("/tt_user/oauth2/token/", { grant_type: "authorization_code", auth_code: authCode, redirect_uri: redirectUri });
    if (!d?.refresh_token || !d.open_id) return null;
    const t = now();
    await cfg.tokens.save(channelId, {
      accessToken: d.access_token!,
      refreshToken: d.refresh_token,
      accessExpiresAt: t + (d.expires_in ?? 86400) * 1000,
      refreshExpiresAt: t + (d.refresh_token_expires_in ?? 31536000) * 1000,
    });
    return { openId: d.open_id };
  }

  // CHƯA XÁC MINH: mã lỗi token hết hạn. Tạm coi lỗi có chữ "token", "expired" hoặc "auth" là cần làm mới, thử lại một lần.
  const isAuthError = (j: Api) => !!j.code && /token|expired|authori/i.test(j.message ?? "");

  async function call<T>(channelId: string, run: (token: string) => Promise<Api<T>>): Promise<Api<T>> {
    let token = await validToken(channelId);
    if (!token) return { code: -1, message: "Chưa cấp quyền hoặc token TikTok đã hết hạn, cần kết nối lại" };
    let j = await run(token);
    if (isAuthError(j)) {
      const t = await refresh(channelId);
      if (!t) return { code: -1, message: "Token TikTok hết hạn, cần kết nối lại" };
      token = t.accessToken;
      j = await run(token);
    }
    return j;
  }

  const sendJson = (token: string, body: object) =>
    doFetch(`${BASE}/business/message/send/`, {
      method: "POST",
      headers: { "content-type": "application/json", "Access-Token": token },
      body: JSON.stringify(body),
    }).then((r) => r.json().catch(() => ({}))) as Promise<Api<{ message?: { message_id?: string } }>>;

  async function uploadImage(token: string, businessId: string, url: string): Promise<Api<{ media_id?: string }>> {
    const img = await doFetch(url);
    if (!img.ok) return { code: -1, message: `Không tải được ảnh (${img.status})` };
    const type = (img.headers.get("content-type") ?? "").split(";")[0];
    if (type !== "image/jpeg" && type !== "image/png") return { code: -1, message: "Chỉ gửi được ảnh jpg hoặc png" };
    const buf = await img.arrayBuffer();
    if (buf.byteLength > MAX_IMAGE) return { code: -1, message: "Ảnh lớn hơn 3MB" };
    const form = new FormData();
    form.set("business_id", businessId);
    form.set("media_type", "IMAGE");
    form.set("file", new Blob([buf], { type }), type === "image/png" ? "image.png" : "image.jpg");
    const r = await doFetch(`${BASE}/business/message/media/upload/`, { method: "POST", headers: { "Access-Token": token }, body: form });
    return (await r.json().catch(() => ({}))) as Api<{ media_id?: string }>;
  }

  const adapter: ChannelAdapter = {
    id: "tiktok",
    // Tối đa 10 tin trong 48 giờ kể từ tin cuối của khách; khách nhắn tiếp thì mở cửa sổ mới.
    replyWindowMs: 48 * 3600 * 1000,
    maxRepliesPerWindow: 10,
    verify(headers, rawBody) {
      const h = headers.get("tiktok-signature");
      if (!h) return false;
      const kv = Object.fromEntries(h.split(",").map((p) => [p.slice(0, p.indexOf("=")).trim(), p.slice(p.indexOf("=") + 1).trim()]));
      const t = kv.t, s = kv.s?.toLowerCase();
      if (!t || !s || !/^\d+$/.test(t)) return false;
      if (Math.abs(now() / 1000 - Number(t)) > tolerance) return false; // quá cũ: nghi phát lại
      // Ký trên `t.` + JSON của body. Thử nguyên văn, rồi dạng JSON.stringify(parse(body)).
      let compact: string | null = null;
      try { compact = JSON.stringify(JSON.parse(rawBody)); } catch { /* bỏ */ }
      return safeEq(s, hmac(cfg.clientSecret, `${t}.${rawBody}`)) || (compact !== null && safeEq(s, hmac(cfg.clientSecret, `${t}.${compact}`)));
    },
    parse(payload): InboundEvent[] {
      const e = payload as RawEvent;
      // im_receive_msg_eu (người dùng EEA/Thụy Sĩ/Anh): chưa xác minh cấu trúc nên chưa xử lý.
      if (e?.event !== "im_receive_msg" && e?.event !== "im_send_msg") return [];
      if (e.client_key && e.client_key !== cfg.clientKey) return [];
      if (!e.user_openid || !e.content) return [];
      let c: RawContent;
      try { c = JSON.parse(e.content) as RawContent; } catch { return []; }
      if (!c.message_id || !c.conversation_id) return [];
      const inbound = e.event === "im_receive_msg";
      const person = inbound ? c.from_user : c.to_user;
      if (!person?.id) return [];
      const atts: Attachment[] = [];
      let text = "";
      if (c.type === "text") text = c.text?.body ?? "";
      else if (c.type === "image" && c.image?.media_id) atts.push({ type: "image", url: tiktokMediaRef(c.conversation_id, c.message_id, c.image.media_id) });
      else if (c.type === "share_post") text = c.share_post?.embed_url ? `[Video TikTok] ${c.share_post.embed_url}` : "[Video TikTok]";
      else text = `[Tin ${c.type ?? "không rõ"}]`;
      return [{
        channelExternalId: e.user_openid,
        conversationExternalId: c.conversation_id,
        contact: { externalId: person.id, name: inbound ? c.from : c.to },
        message: {
          externalId: c.message_id,
          direction: inbound ? "in" : "out",
          text,
          attachments: atts,
          at: c.timestamp ?? (e.create_time ?? Math.floor(now() / 1000)) * 1000,
        },
      }];
    },
    async send({ channel, conversationExternalId, text, attachments }: SendInput): Promise<SendResult> {
      if (!conversationExternalId) return { ok: false, error: "Thiếu mã hội thoại TikTok" };
      const businessId = channel.externalId; // open_id
      // Một tin không được vừa chữ vừa ảnh: gửi riêng từng tin.
      const steps: Array<{ kind: "text"; body: string } | { kind: "image"; url: string }> = [];
      if (text) steps.push({ kind: "text", body: text });
      for (const a of attachments ?? []) {
        if (a.type !== "image") return { ok: false, error: `Chưa hỗ trợ gửi tệp loại ${a.type}` };
        steps.push({ kind: "image", url: a.url });
      }
      if (!steps.length) return { ok: false, error: "Tin rỗng" };
      let last: string | undefined;
      for (const st of steps) {
        const base = { business_id: businessId, recipient_type: "CONVERSATION", recipient: conversationExternalId };
        const j = await call(channel.id, async (token) => {
          if (st.kind === "text") {
            if (st.body.length > 6000) return { code: -1, message: "Tin dài quá 6.000 ký tự" };
            return sendJson(token, { ...base, message_type: "TEXT", text: { body: st.body } });
          }
          const up = await uploadImage(token, businessId, st.url);
          if (up.code !== 0 || !up.data?.media_id) return up as Api<{ message?: { message_id?: string } }>;
          return sendJson(token, { ...base, message_type: "IMAGE", image: { media_id: up.data.media_id } });
        });
        if (j.code !== 0) return { ok: false, error: `TikTok ${j.code ?? "?"}: ${j.message ?? "lỗi"}` };
        last = (j.data as { message?: { message_id?: string } } | undefined)?.message?.message_id;
      }
      return { ok: true, externalId: last };
    },
    async refreshToken(channel) {
      await refresh(channel.id);
    },
  };

  // Lấy link tải ảnh/video của tin đến (hiệu lực 24 giờ). Khi tải link phải kèm header `x-user: <access token>`.
  async function resolveMedia(channel: SendInput["channel"], ref: string, mediaType: "IMAGE" | "VIDEO" = "IMAGE") {
    const m = parseTikTokMediaRef(ref);
    if (!m) return null;
    const token = await validToken(channel.id);
    if (!token) return null;
    const j = await call(channel.id, async (tk) =>
      (await doFetch(`${BASE}/business/message/media/download/`, {
        method: "POST",
        headers: { "content-type": "application/json", "Access-Token": tk },
        body: JSON.stringify({ business_id: channel.externalId, conversation_id: m.conversationId, message_id: m.messageId, media_id: m.mediaId, media_type: mediaType }),
      }).then((r) => r.json().catch(() => ({})))) as Api<{ download_url?: string }>
    );
    const url = (j.data as { download_url?: string } | undefined)?.download_url;
    const tk = (await cfg.tokens.get(channel.id))?.accessToken;
    return j.code === 0 && url && tk ? { url, headers: { "x-user": tk } } : null;
  }

  return Object.assign(adapter, { connect, resolveMedia });
}
