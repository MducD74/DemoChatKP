// Kết nối kênh: tạo/gỡ kênh, lưu token, OAuth (Zalo, TikTok), đăng ký nhận tin. Không chứa mã giao diện.
import { createHash, randomBytes } from "node:crypto";
import { mutate, type DB, type Store } from "./store";
import type { Channel, ChannelKind } from "./types";
import { decryptJson, encryptJson } from "./secret";
import { staticTokens, storeBackedTokens } from "./token-store";
import { isOnline } from "./routing";
import { hasZaloSession, stopZaloPersonal, zaloPersonalState, zaloSessionKey } from "./zalopersonal";

// Kênh thêm tay. Zalo cá nhân không có ở đây: chỉ tạo được bằng quét QR (src/core/zalopersonal.ts).
export const SUPPORTED_KINDS: ChannelKind[] = ["facebook", "instagram", "zalo_oa", "tiktok"];
const rand = (n: number) => randomBytes(n).toString("hex");
const GRAPH = "https://graph.facebook.com/v27.0";
const STATE_TTL = 15 * 60 * 1000;

// ---------- Kênh ----------
export async function createChannel(
  store: Store,
  input: { kind: ChannelKind; name: string; externalId?: string; pageId?: string; companyId?: string }
): Promise<{ ok: true; channel: Channel } | { ok: false; error: string }> {
  if (!SUPPORTED_KINDS.includes(input.kind)) return { ok: false, error: "Loại kênh chưa hỗ trợ" };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Thiếu tên kênh" };
  const externalId = (input.externalId ?? "").trim();
  const pageId = (input.pageId ?? "").trim();
  if ((input.kind === "facebook" || input.kind === "instagram") && !externalId) {
    return { ok: false, error: input.kind === "facebook" ? "Thiếu Page ID" : "Thiếu ID tài khoản Instagram" };
  }
  if (input.kind === "instagram" && !pageId) return { ok: false, error: "Thiếu Page ID của Page liên kết với Instagram" };
  // Zalo OA và TikTok: mã ngoài (oa_id, open_id) chỉ có sau khi cấp quyền, nên để trống.
  return mutate(store, (db): { ok: true; channel: Channel } | { ok: false; error: string } => {
    if (externalId && Object.values(db.channels).some((c) => c.kind === input.kind && c.externalId === externalId && !c.off)) {
      return { ok: false, error: "Kênh này đã được thêm" };
    }
    const channel: Channel = {
      id: `${input.kind}-${rand(4)}`,
      companyId: input.companyId ?? "default",
      kind: input.kind,
      externalId,
      name,
      sendEnabled: false, // luôn tắt khi mới tạo
      ...(input.kind === "instagram" ? { meta: { pageId } } : {}),
    };
    db.channels[channel.id] = channel;
    return { ok: true, channel };
  });
}

// Gỡ kết nối: xóa token, tắt kênh, giữ lại lịch sử hội thoại. Kênh chưa có hội thoại thì xóa hẳn.
export function removeChannel(store: Store, id: string): Promise<"removed" | "disconnected" | null> {
  stopZaloPersonal(id); // ngắt phiên Zalo cá nhân đang nghe (nếu có) trước khi xoá khoá phiên
  return mutate(store, (db) => {
    const ch = db.channels[id];
    if (!ch) return null;
    for (const k of Object.keys(db.secrets ?? {})) if (k === id || k === `static:${id}` || k === zaloSessionKey(id)) delete db.secrets![k];
    const used = Object.values(db.conversations).some((c) => c.channelId === id);
    if (used) {
      ch.off = true;
      ch.sendEnabled = false;
      return "disconnected" as const;
    }
    delete db.channels[id];
    return "removed" as const;
  });
}

export interface ChannelView {
  id: string;
  kind: ChannelKind;
  name: string;
  externalId: string;
  pageId?: string;
  sendEnabled: boolean;
  off: boolean;
  access: Record<string, "send" | "view">;
  sla?: import("./types").SlaCfg;
  routing?: import("./types").RoutingCfg;
  // Tình hình từng nhân viên trong kênh (cho màn hình Chia khách)
  people: Record<string, { open: number; online: boolean; away: boolean }>;
  unassigned: number;
  status: "pending" | "connected" | "expired" | "no_token";
  note?: string; // lời nhắn về tình trạng kết nối (Zalo cá nhân: bị đăng nhập nơi khác, mất kết nối...)
  accessExpiresAt?: number;
  refreshExpiresAt?: number;
}

function staffState(db: DB, channelId: string, access: Record<string, string>, now: number) {
  const out: ChannelView["people"] = {};
  for (const uid of Object.keys(access)) {
    out[uid] = {
      open: Object.values(db.conversations).filter((c) => c.channelId === channelId && c.assigneeUid === uid && c.status !== "resolved").length,
      online: isOnline(db, uid, now),
      away: !!db.away?.[uid],
    };
  }
  return out;
}

export async function channelViews(store: Store, now = Date.now()): Promise<ChannelView[]> {
  const db = await store.load();
  const tokens = storeBackedTokens(store);
  const statics = staticTokens(store);
  const out: ChannelView[] = [];
  for (const c of Object.values(db.channels)) {
    const v: ChannelView = {
      id: c.id, kind: c.kind, name: c.name, externalId: c.externalId, pageId: c.meta?.pageId,
      sendEnabled: c.sendEnabled, off: !!c.off, access: c.access ?? {}, sla: c.sla, routing: c.routing, people: staffState(db, c.id, c.access ?? {}, now), unassigned: Object.values(db.conversations).filter((x) => x.channelId === c.id && !x.assigneeUid && x.status !== "resolved").length, status: "pending",
    };
    if (c.kind === "facebook" || c.kind === "instagram") {
      v.status = (await statics.get(c.id)) ? "connected" : "no_token";
    } else if (c.kind === "web") {
      v.status = "connected"; // khung chat trên web không cần token
    } else if (c.kind === "zalo_personal") {
      const live = zaloPersonalState(c.id);
      v.note = live?.note;
      v.status = !(await hasZaloSession(store, c.id)) ? "pending" : live?.status === "online" ? "connected" : "expired";
    } else {
      const t = await tokens.get(c.id);
      if (!c.externalId || !t) v.status = c.externalId ? "no_token" : "pending";
      else {
        v.accessExpiresAt = t.accessExpiresAt;
        v.refreshExpiresAt = t.refreshExpiresAt;
        v.status = t.refreshExpiresAt > now ? "connected" : "expired";
      }
    }
    out.push(v);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- Trạng thái OAuth (state một lần dùng, hết hạn sau 15 phút) ----------
interface OAuthState { channelId: string; kind: ChannelKind; verifier?: string; at: number; rerequest?: boolean }
const stKey = (s: string) => `oauth-state:${s}`;

export async function beginOAuth(store: Store, channelId: string, kind: ChannelKind, withPkce: boolean, now = Date.now()) {
  return mutate(store, (db) => {
    const ch = db.channels[channelId];
    if (!ch || ch.kind !== kind) return null;
    const state = rand(16);
    // code verifier: 43 ký tự gồm chữ hoa, chữ thường, số
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const verifier = withPkce ? Array.from(randomBytes(43), (b) => alphabet[b % alphabet.length]).join("") : undefined;
    (db.secrets ??= {})[stKey(state)] = encryptJson({ channelId, kind, verifier, at: now } satisfies OAuthState);
    return { state, challenge: verifier ? pkceChallenge(verifier) : undefined };
  });
}

// Phiên đăng nhập Facebook (chưa có kênh): chỉ cần state một lần dùng
export async function beginMetaLogin(store: Store, now = Date.now(), rerequest = false) {
  return mutate(store, (db) => {
    const state = rand(16);
    (db.secrets ??= {})[stKey(state)] = encryptJson({ channelId: "", kind: "facebook", at: now, ...(rerequest ? { rerequest: true } : {}) } satisfies OAuthState);
    return state;
  });
}

export async function consumeOAuth(store: Store, state: string, kind: ChannelKind, now = Date.now()): Promise<OAuthState | null> {
  return mutate(store, (db) => {
    const blob = db.secrets?.[stKey(state)];
    if (!blob) return null;
    delete db.secrets![stKey(state)]; // dùng một lần
    const s = decryptJson<OAuthState>(blob);
    return s.kind === kind && now - s.at <= STATE_TTL ? s : null;
  });
}

// Theo tài liệu Zalo: SHA-256 của code verifier rồi Base64 không đệm. Dùng base64url (RFC 7636), CHƯA XÁC MINH Zalo có chấp nhận cả base64 thường.
export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier, "ascii").digest("base64url");

export async function setChannelExternalId(store: Store, channelId: string, externalId: string) {
  return mutate(store, (db) => {
    if (!db.channels[channelId]) return false;
    db.channels[channelId].externalId = externalId;
    db.channels[channelId].off = false;
    return true;
  });
}

// CHƯA XÁC MINH: định dạng URL cấp quyền Zalo. Theo tài liệu, URL được tạo ở Zalo for Developers (nhập callback và code challenge).
// Đây là dạng phổ biến của Zalo OAuth v4; nếu portal sinh URL khác thì dùng URL đó (tham số state và code_challenge giữ nguyên ý nghĩa).
export const zaloAuthUrl = (appId: string, redirectUri: string, challenge: string, state: string) =>
  `https://oauth.zaloapp.com/v4/oa/permission?${new URLSearchParams({ app_id: appId, redirect_uri: redirectUri, code_challenge: challenge, state })}`;

// TikTok: URL cấp quyền lấy ở My Apps > App Detail > Basic Information, thêm state để chống CSRF (theo tài liệu).
export function tiktokAuthUrl(portalUrl: string, state: string) {
  const u = new URL(portalUrl);
  u.searchParams.set("state", state);
  return u.toString();
}

// ---------- Meta ----------
// Kiểm token Page dán tay: còn hiệu lực và đúng Page. Có khóa ứng dụng thì dùng debug_token (không đòi quyền trên Page);
// không có thì dùng /me (đòi quyền pages_read_engagement).
export async function verifyMetaToken(token: string, expectedId: string, fetchImpl: typeof fetch = fetch, app?: { appId?: string; appSecret?: string }) {
  if (app?.appId && app.appSecret) {
    const r = await fetchImpl(`${GRAPH}/debug_token?${new URLSearchParams({ input_token: token })}`, { headers: { authorization: `Bearer ${app.appId}|${app.appSecret}` } });
    const j = (await r.json().catch(() => ({}))) as { data?: { is_valid?: boolean; profile_id?: string; error?: { message?: string } }; error?: { message?: string } };
    if (!r.ok || !j.data) return { ok: false as const, error: `Không kiểm được token: ${j.error?.message ?? r.status}` };
    if (!j.data.is_valid) return { ok: false as const, error: `Meta từ chối token: ${j.data.error?.message ?? "token không còn hiệu lực"}` };
    if (j.data.profile_id && j.data.profile_id !== expectedId) return { ok: false as const, error: `Token thuộc Page ${j.data.profile_id}, không khớp ${expectedId}` };
    return { ok: true as const };
  }
  const r = await fetchImpl(`${GRAPH}/me?fields=id,name`, { headers: { authorization: `Bearer ${token}` } });
  const j = (await r.json().catch(() => ({}))) as { id?: string; name?: string; error?: { message?: string } };
  if (!r.ok || !j.id) return { ok: false as const, error: `Meta từ chối token: ${j.error?.message ?? r.status}` };
  if (j.id !== expectedId) return { ok: false as const, error: `Token thuộc Page ${j.id}, không khớp ${expectedId}` };
  return { ok: true as const, name: j.name };
}

// Đăng ký app nhận tin của Page (POST /{page}/subscribed_apps?subscribed_fields=messages) bằng page token.
export async function subscribeMetaPage(pageId: string, token: string, fetchImpl: typeof fetch = fetch) {
  const r = await fetchImpl(`${GRAPH}/${pageId}/subscribed_apps?subscribed_fields=messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string } };
  return j.success ? { ok: true as const } : { ok: false as const, error: `Meta: ${j.error?.message ?? r.status}` };
}

// ---------- TikTok ----------
// Đăng ký webhook cấp ứng dụng một lần (mọi tài khoản đã cấp quyền sẽ gửi tin về URL này).
export async function subscribeTikTokWebhook(
  cfg: { clientKey: string; clientSecret: string; callbackUrl: string },
  fetchImpl: typeof fetch = fetch
) {
  const r = await fetchImpl("https://business-api.tiktok.com/open_api/v1.3/business/webhook/update/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: cfg.clientKey, secret: cfg.clientSecret, event_type: "DIRECT_MESSAGE", callback_url: cfg.callbackUrl }),
  });
  const j = (await r.json().catch(() => ({}))) as { code?: number; message?: string };
  return j.code === 0 ? { ok: true as const } : { ok: false as const, error: `TikTok ${j.code ?? r.status}: ${j.message ?? "lỗi"}` };
}

// ---------- Cấu hình hiển thị (không chứa bí mật) ----------
export function connectConfig(base: string, env: NodeJS.ProcessEnv = process.env) {
  return {
    publicUrl: base,
    isLocal: /^https?:\/\/(localhost|127\.|\[::1\])/.test(base),
    secretKeySet: !!env.KPCHAT_SECRET_KEY,
    meta: { configured: !!(env.META_APP_SECRET && env.META_VERIFY_TOKEN), loginReady: !!(env.META_APP_ID && env.META_APP_SECRET), usesConfigId: !!env.META_LOGIN_CONFIG_ID },
    zalo: { configured: !!(env.ZALO_APP_ID && env.ZALO_APP_SECRET) },
    tiktok: { configured: !!(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET), authUrlSet: !!env.TIKTOK_AUTH_URL },
    webhooks: {
      facebook: `${base}/api/webhook/facebook`,
      instagram: `${base}/api/webhook/instagram`,
      zalo_oa: `${base}/api/webhook/zalo_oa`,
      tiktok: `${base}/api/webhook/tiktok`,
    },
    redirects: { facebook: `${base}/api/connect/meta/callback`, zalo_oa: `${base}/api/connect/zalo/callback`, tiktok: `${base}/api/connect/tiktok/callback` },
  };
}
