// Khung chat nhúng trên web: mỗi website là một kênh kind "web". Khách không cần đăng nhập; phiên của khách là mã ngẫu nhiên có chữ ký
// HMAC (không lưu gì trong kho cho đến khi khách nhắn tin đầu tiên). API công khai nên có: kiểm khóa kênh, kiểm chữ ký phiên, giới hạn
// tần suất và độ dài, và danh sách website được phép (kiểm theo Origin). Khóa kênh (key) là công khai, nằm trong mã nhúng.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { ingest } from "./ingest";
import { saveVisitorImage, uploadExists } from "./media";
import { needHumanMap } from "./botqueue";
import { messagesOf, mutate, type Store } from "./store";
import { signHmac } from "./secret";
import type { Channel } from "./types";

type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string; status?: number };

export interface WebCfg { title: string; greeting: string; color: string; origins: string[]; position: "right" | "left" }
export const WEB_LANGS = ["vi", "en", "ko", "zh", "ru"];
export const WEB_LIMITS = { name: 80, title: 60, greeting: 200, text: 1000, visitorName: 40, perSid10min: 40, perIp10min: 120, messages: 200, imagesPerMsg: 3, uploadsPerSid10min: 12, uploadsPerIp10min: 40 };
export const DEFAULT_WEB = { title: "Chat với shop", greeting: "Xin chào! Mình có thể giúp gì cho bạn?", color: "#1E3A8A" };
const KEY_RE = /^[a-f0-9]{32}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// ---------- Cấu hình kênh ----------
export const webCfg = (ch: Pick<Channel, "meta">): WebCfg => ({
  title: ch.meta?.title || DEFAULT_WEB.title,
  greeting: ch.meta?.greeting || DEFAULT_WEB.greeting,
  color: ch.meta?.color && COLOR_RE.test(ch.meta.color) ? ch.meta.color : DEFAULT_WEB.color,
  origins: (ch.meta?.origins ?? "").split(",").map((x) => x.trim()).filter(Boolean),
  position: ch.meta?.position === "left" ? "left" : "right",
});

// Chuẩn hóa một website thành "scheme://host[:port]". Chấp nhận dán cả địa chỉ trang.
export function normOrigin(raw: string): string | null {
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch { return null; }
}

export interface WebInput { position?: unknown; name?: unknown; title?: unknown; greeting?: unknown; color?: unknown; origins?: unknown }

function cleanInput(input: WebInput, base?: Channel): Res<{ name: string; meta: Record<string, string> }> {
  const name = String(input.name ?? base?.name ?? "").trim();
  if (!name || name.length > WEB_LIMITS.name) return { ok: false, error: `Tên khung chat từ 1 đến ${WEB_LIMITS.name} ký tự` };
  const title = String(input.title ?? base?.meta?.title ?? DEFAULT_WEB.title).trim() || DEFAULT_WEB.title;
  const greeting = String(input.greeting ?? base?.meta?.greeting ?? DEFAULT_WEB.greeting).trim() || DEFAULT_WEB.greeting;
  if (title.length > WEB_LIMITS.title) return { ok: false, error: `Tiêu đề tối đa ${WEB_LIMITS.title} ký tự` };
  if (greeting.length > WEB_LIMITS.greeting) return { ok: false, error: `Lời chào tối đa ${WEB_LIMITS.greeting} ký tự` };
  const color = String(input.color ?? base?.meta?.color ?? DEFAULT_WEB.color).trim();
  if (!COLOR_RE.test(color)) return { ok: false, error: "Màu có dạng #RRGGBB" };
  const rawOrigins = Array.isArray(input.origins) ? input.origins.map(String) : String(input.origins ?? base?.meta?.origins ?? "").split(/[\n,]/);
  const origins: string[] = [];
  for (const o of rawOrigins.map((x) => x.trim()).filter(Boolean)) {
    const n = normOrigin(o);
    if (!n) return { ok: false, error: `Địa chỉ website không hợp lệ: ${o.slice(0, 60)}` };
    if (!origins.includes(n)) origins.push(n);
  }
  if (origins.length > 10) return { ok: false, error: "Tối đa 10 website" };
  const position = String(input.position ?? base?.meta?.position ?? "right") === "left" ? "left" : "right";
  return { ok: true, name, meta: { title, greeting, color, origins: origins.join(","), position } };
}

export async function createWebChannel(store: Store, input: WebInput): Promise<Res<{ channel: Channel }>> {
  const c = cleanInput(input);
  if (!c.ok) return c;
  return mutate(store, (db): Res<{ channel: Channel }> => {
    const key = randomBytes(16).toString("hex");
    const channel: Channel = { id: `web-${randomBytes(4).toString("hex")}`, companyId: "default", kind: "web", externalId: key, name: c.name, sendEnabled: true, meta: c.meta };
    db.channels[channel.id] = channel;
    return { ok: true, channel };
  });
}

export async function updateWebChannel(store: Store, id: string, input: WebInput): Promise<Res<{ channel: Channel }>> {
  return mutate(store, (db): Res<{ channel: Channel }> => {
    const ch = db.channels[id];
    if (!ch || ch.kind !== "web") return { ok: false, error: "Không thấy khung chat" };
    const c = cleanInput(input, ch);
    if (!c.ok) return c;
    ch.name = c.name; ch.meta = c.meta;
    return { ok: true, channel: ch };
  });
}

// ---------- Phiên khách ----------
export function newSid(key: string): string {
  const r = randomBytes(18).toString("base64url");
  return `${r}.${signHmac(`web:${key}:${r}`).slice(0, 24)}`;
}
export function validSid(key: string, sid: unknown): sid is string {
  if (typeof sid !== "string" || sid.length > 80) return false;
  const [r, sig, extra] = sid.split(".");
  if (!r || !sig || extra !== undefined || !/^[A-Za-z0-9_-]{20,30}$/.test(r)) return false;
  const want = Buffer.from(signHmac(`web:${key}:${r}`).slice(0, 24));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

// ---------- Tìm kênh và CORS ----------
export async function webChannel(store: Store, key: unknown): Promise<Channel | null> {
  if (typeof key !== "string" || !KEY_RE.test(key)) return null;
  return Object.values((await store.load()).channels).find((c) => c.kind === "web" && c.externalId === key && !c.off) ?? null;
}

// Trả giá trị cho Access-Control-Allow-Origin, hoặc null nếu website này không được phép. Chưa khai website nào thì cho mọi website.
export function allowedOrigin(ch: Pick<Channel, "meta">, origin: string | null): string | null {
  const list = webCfg(ch).origins;
  if (!list.length) return "*";
  if (!origin) return "*"; // không có Origin (gọi từ máy chủ, cùng nguồn): để các kiểm tra khác lo
  return list.includes(origin) ? origin : null;
}

// ---------- Giới hạn tần suất (trong bộ nhớ) ----------
const g = globalThis as unknown as { __kpWebHits?: Map<string, number[]> };
export function rateHit(bucket: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const m: Map<string, number[]> = (g.__kpWebHits ??= new Map());
  const arr = (m.get(bucket) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) { m.set(bucket, arr); return false; }
  arr.push(now);
  m.set(bucket, arr);
  if (m.size > 20000) for (const k of m.keys()) { if (!(m.get(k) ?? []).some((t) => now - t < windowMs)) m.delete(k); }
  return true;
}

// ---------- Tin nhắn ----------
export interface WebMsg { id: string; from: "visitor" | "bot" | "agent"; text: string; images: string[]; at: number }

export async function webMessages(store: Store, ch: Channel, sid: string, after = 0): Promise<WebMsg[]> {
  const db = await store.load();
  const convId = `${ch.id}:conv:${sid}`;
  return messagesOf(db, convId)
    .filter((m) => !m.internal && m.at > after)
    .slice(-WEB_LIMITS.messages)
    .map((m) => ({ id: m.id, from: m.direction === "in" ? "visitor" as const : m.bot ? "bot" as const : "agent" as const, text: m.text, images: m.attachments.filter((a) => a.type === "image").map((a) => a.url), at: m.at }));
}

// Khách tải ảnh lên để đính kèm tin: trả về địa chỉ ảnh (<base>/api/media/<mã>). Kiểm phiên và giới hạn riêng (nhẹ hơn tin chữ nhưng chặt hơn về số lần).
export async function webUpload(sid: string, bytes: Uint8Array, base: string, ip = "", now = Date.now()): Promise<Res<{ url: string }>> {
  if (!rateHit(`up-sid:${sid}`, WEB_LIMITS.uploadsPerSid10min, 600_000, now) || (ip && !rateHit(`up-ip:${ip}`, WEB_LIMITS.uploadsPerIp10min, 600_000, now))) return { ok: false, error: "Bạn gửi ảnh quá nhanh, vui lòng thử lại sau ít phút", status: 429 };
  const r = await saveVisitorImage(bytes);
  if (!r.ok) return { ok: false, error: r.error, status: 400 };
  return { ok: true, url: `${base.replace(/\/$/, "")}/api/media/${r.id}` };
}

// Chỉ nhận ảnh đã tải lên chính KP Chat này: lấy mã tệp từ địa chỉ rồi tự dựng lại địa chỉ bằng base của máy chủ (không tin địa chỉ khách gửi, tránh chèn ảnh/địa chỉ ngoài).
async function cleanImages(raw: unknown, base: string): Promise<Res<{ urls: string[] }>> {
  if (raw === undefined || raw === null) return { ok: true, urls: [] };
  if (!Array.isArray(raw) || raw.length > WEB_LIMITS.imagesPerMsg) return { ok: false, error: `Tối đa ${WEB_LIMITS.imagesPerMsg} ảnh mỗi tin`, status: 400 };
  const urls: string[] = [];
  for (const u of raw) {
    const m = typeof u === "string" ? /\/api\/media\/([0-9a-f]{32}\.(?:jpg|png|webp))$/.exec(u.split(/[?#]/)[0]) : null;
    if (!m || !(await uploadExists(m[1]))) return { ok: false, error: "Ảnh đính kèm không hợp lệ", status: 400 };
    const url = `${base.replace(/\/$/, "")}/api/media/${m[1]}`;
    if (!urls.includes(url)) urls.push(url);
  }
  return { ok: true, urls };
}

// Khách đang chờ nhân viên (bot đã chuyển người, chưa ai trả lời): khung chat báo "nhân viên sẽ trả lời sớm" thay vì để khách chờ trong im lặng.
export async function webHandoff(store: Store, ch: Channel, sid: string, now = Date.now()): Promise<boolean> {
  return needHumanMap(await store.load(), now).has(`${ch.id}:conv:${sid}`);
}

export async function webSend(store: Store, ch: Channel, sid: string, input: { text?: unknown; name?: unknown; lang?: unknown; images?: unknown }, ip = "", now = Date.now(), base = ""): Promise<Res<{ message: WebMsg }>> {
  const text = String(input.text ?? "").replace(/\r\n?/g, "\n").trim();
  const im = await cleanImages(input.images, base);
  if (!im.ok) return im;
  if (!text && !im.urls.length) return { ok: false, error: "Tin rỗng", status: 400 };
  if (text.length > WEB_LIMITS.text) return { ok: false, error: `Tin tối đa ${WEB_LIMITS.text} ký tự`, status: 400 };
  if (!rateHit(`sid:${sid}`, WEB_LIMITS.perSid10min, 600_000, now) || (ip && !rateHit(`ip:${ip}`, WEB_LIMITS.perIp10min, 600_000, now))) return { ok: false, error: "Bạn nhắn quá nhanh, vui lòng thử lại sau ít phút", status: 429 };
  const name = String(input.name ?? "").replace(/\s+/g, " ").trim().slice(0, WEB_LIMITS.visitorName) || `Khách web ${sid.slice(0, 4)}`;
  const id = `w-${now.toString(36)}${randomBytes(4).toString("hex")}`;
  const attachments = im.urls.map((url) => ({ type: "image" as const, url }));
  const r = await ingest(store, "web", [{ channelExternalId: ch.externalId, contact: { externalId: sid, name }, message: { externalId: id, direction: "in", text, attachments, at: now } }]);
  if (r.stored !== 1) return { ok: false, error: "Không gửi được", status: 500 };
  const lang = String(input.lang ?? "").toLowerCase();
  if (WEB_LANGS.includes(lang)) await mutate(store, (db) => { const c = db.contacts[`${ch.id}:${sid}`]; if (c && c.lang !== lang) c.lang = lang; });
  return { ok: true, message: { id: `${ch.id}:${id}`, from: "visitor", text, images: im.urls, at: now } };
}
