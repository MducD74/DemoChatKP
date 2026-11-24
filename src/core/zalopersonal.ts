// Zalo cá nhân: KP Chat đóng vai "trình duyệt" đăng nhập Zalo. Quét QR một lần, KP Chat giữ phiên và nghe tin như một tab Zalo Web.
// Dùng thư viện cộng đồng zca-js (KHÔNG phải API chính thức của Zalo, vi phạm điều khoản Zalo, có nguy cơ bị khoá số). Xem docs/KE-HOACH-2.0.md.
// Chat 1-1, và nhóm chat nếu quản trị bật riêng từng nhóm (mặc định tắt). Phiên (cookie, imei) lưu mã hoá AES-256-GCM trong kho.
// Gửi tin (chữ, ảnh) có giãn cách và hạn mức ngày để giảm nguy cơ bị khoá.
import { randomBytes } from "node:crypto";
import { decryptJson, encryptJson } from "./secret";
import { ZALO_PERSONAL_ENABLED, ZALO_PERSONAL_OFF } from "./guardrails";
import { ingest } from "./ingest";
import { enrichProfiles } from "./profile";
import { mutate, type Store } from "./store";
import type { Attachment, Channel, InboundEvent } from "./types";

// ---------- Giao diện tối thiểu của zca-js (để thay bằng bản giả khi test) ----------
export interface ZCreds { cookie: unknown; imei: string; userAgent: string }
export interface ZMsg {
  type: number; // 0 = chat 1-1, 1 = nhóm
  threadId: string;
  isSelf: boolean;
  data: { msgId: string | number; ts: string | number; dName?: string; msgType?: string; content: unknown };
}
type Listener = {
  on(event: string, cb: (...a: any[]) => void): unknown; start(o?: { retryOnClose?: boolean }): void; stop(): void;
  requestOldMessages(threadType: number, lastMsgId?: string | null): void; // kết quả về qua sự kiện "old_messages"
};
// Ảnh/tệp gửi từ bộ nhớ (zca-js cũng nhận đường dẫn tệp, nhưng KP Chat chỉ có byte đã tải lên)
export interface ZSource { data: Buffer; filename: string; metadata: { totalSize: number; width?: number; height?: number } }
export interface ZSendResult { message: { msgId: number | string } | null; attachment?: Array<{ msgId: number | string }> }
export interface ZApi {
  listener: Listener;
  getOwnId(): string;
  sendMessage(msg: string | { msg: string; attachments?: ZSource | ZSource[] }, threadId: string, type?: number): Promise<ZSendResult>;
  getUserInfo(id: string): Promise<{ changed_profiles?: Record<string, { displayName?: string; zaloName?: string; username?: string; avatar?: string }> }>;
  getAllGroups(): Promise<{ gridVerMap: Record<string, string> }>;
  getGroupInfo(ids: string | string[]): Promise<{ gridInfoMap: Record<string, { name?: string; avt?: string; totalMember?: number }> }>;
}
export interface ZClient {
  loginQR(opts: { userAgent?: string }, cb: (e: any) => unknown): Promise<ZApi>;
  login(creds: ZCreds): Promise<ZApi>;
}
export interface ZDeps {
  create: () => Promise<ZClient>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export const defaultDeps: ZDeps = {
  // Nạp thư viện khi cần, tắt kiểm tra cập nhật (nó gọi registry.npmjs.org) và nhật ký. selfListen: nhận cả tin gửi từ điện thoại.
  async create() {
    if (!ZALO_PERSONAL_ENABLED) throw new Error(ZALO_PERSONAL_OFF);
    const { Zalo } = await import("zca-js");
    return new Zalo({ selfListen: true, checkUpdate: false, logging: false }) as unknown as ZClient;
  },
};

// ---------- Hằng số an toàn ----------
export const MIN_GAP_MS = 2500; // giãn cách tối thiểu giữa hai tin gửi của cùng một số (cộng thêm ngẫu nhiên đến 2,5 giây)
export const JITTER_MS = 2500;
export const dailyCap = () => Math.max(1, Number(process.env.ZALO_PERSONAL_DAILY_CAP) || 300);
const FLOW_TTL = 10 * 60_000;
const RECONNECT_DELAYS = [30_000, 120_000, 600_000]; // nối lại tối đa 3 lần khi rớt mạng, rồi chờ nhân viên quét lại
const KICK_CODES = new Set([3000, 3003]); // đăng nhập nơi khác (Zalo Web...)

// ---------- Trạng thái trong bộ nhớ (để trên globalThis vì Next nạp lại mô-đun khi sửa file) ----------
type Status = "connecting" | "online" | "offline" | "kicked" | "invalid";
interface Live {
  api?: ZApi; status: Status; note?: string; day: string; sent: number; nextAt: number; chain: Promise<unknown>; tries: number;
  groups: Set<string>; // các nhóm được bật (mã nhóm Zalo); tin nhóm khác bị bỏ
  onOld?: (msgs: ZMsg[], type: number) => void; // đang tải tin cũ (xem zalohistory.ts)
}
export interface Flow {
  id: string;
  status: "starting" | "qr" | "scanned" | "done" | "expired" | "declined" | "error";
  qr?: string; // ảnh PNG base64
  name?: string;
  avatar?: string;
  channelId?: string;
  error?: string;
  at: number;
  creds?: ZCreds;
  expect?: string;
  abort?: () => unknown;
}
const g = globalThis as unknown as { __kpZaloP?: { live: Map<string, Live>; flows: Map<string, Flow>; resumed: boolean } };
const st = (g.__kpZaloP ??= { live: new Map(), flows: new Map(), resumed: false });

const sKey = (channelId: string) => `zalo-p:${channelId}`;
const nowOf = (d: ZDeps) => (d.now ?? Date.now)();
const sleepOf = (d: ZDeps) => d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
const vnDay = (t: number) => new Date(t + 7 * 3600_000).toISOString().slice(0, 10);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------- Nhóm chat ----------
// Khách nhóm có mã ngoài "g:<mã nhóm>" (không trùng mã người dùng). Nhóm mặc định tắt; quản trị bật từng nhóm, lưu ở channel.meta.groups.
export const GROUP_PREFIX = "g:";
export const isGroupId = (externalId: string) => externalId.startsWith(GROUP_PREFIX);
export const MAX_GROUPS = 200;
export const groupSet = (ch?: Pick<Channel, "meta"> | null): Set<string> => new Set((ch?.meta?.groups ?? "").split(",").filter((x) => /^\d+$/.test(x)));

// ---------- Đổi tin Zalo thành sự kiện chuẩn của KP Chat ----------
export function toEvent(ownId: string, m: ZMsg, groups?: ReadonlySet<string>): InboundEvent | null {
  const isGroup = m.type === 1;
  if (m.type !== 0 && !isGroup) return null;
  if (isGroup && !groups?.has(m.threadId)) return null; // nhóm chưa được bật: bỏ qua
  const d = m.data;
  const peer = m.threadId;
  if (!peer || peer === ownId || d.msgId == null) return null;
  const at = Number(d.ts) || Date.now();
  const kind = String(d.msgType ?? "");
  let text = "";
  const attachments: Attachment[] = [];
  if (typeof d.content === "string") text = d.content;
  else if (d.content && typeof d.content === "object") {
    const c = d.content as { href?: string; title?: string; description?: string };
    if (kind.includes("photo") && c.href) { attachments.push({ type: "image", url: c.href }); text = c.description ?? ""; }
    else if (kind.includes("file") && c.href) attachments.push({ type: "file", url: c.href, name: c.title });
    else if (c.href) text = c.title ? `${c.title} ${c.href}` : c.href;
    else text = `[Tin nhắn ${kind || "khác"} chưa hiển thị được]`;
  }
  if (!text && !attachments.length) return null;
  if (isGroup) {
    // Hội thoại nhóm: tên nhóm lấy qua fetchProfile; tin của khách ghi rõ ai nói (hộp thư chỉ có một "khách" là cả nhóm)
    const who = m.isSelf ? "" : d.dName?.trim() || "Thành viên";
    if (who) text = text ? `${who}: ${text}` : `${who}:`;
    return {
      channelExternalId: ownId,
      contact: { externalId: GROUP_PREFIX + peer },
      message: { externalId: String(d.msgId), direction: m.isSelf ? "out" : "in", text, attachments, at },
    };
  }
  return {
    channelExternalId: ownId,
    contact: { externalId: peer, name: m.isSelf ? undefined : d.dName?.trim() || undefined },
    message: { externalId: String(d.msgId), direction: m.isSelf ? "out" : "in", text, attachments, at },
  };
}

async function onMessage(store: Store, ownId: string, m: ZMsg, groups: ReadonlySet<string>) {
  const ev = toEvent(ownId, m, groups);
  if (!ev) return;
  const r = await ingest(store, "zalo_personal", [ev]);
  if (r.needProfile.length) await enrichProfiles(store, "zalo_personal", r.needProfile).catch(() => 0);
}

// ---------- Gắn listener cho một phiên đã đăng nhập ----------
function attach(store: Store, channelId: string, ownId: string, api: ZApi, deps: ZDeps, groups: Set<string>) {
  st.live.get(channelId)?.api?.listener.stop();
  const live: Live = { api, status: "connecting", day: vnDay(nowOf(deps)), sent: 0, nextAt: 0, chain: Promise.resolve(), tries: 0, groups };
  st.live.set(channelId, live);
  const own = () => st.live.get(channelId) === live; // phiên cũ đã bị thay thì không làm gì nữa
  api.listener.on("connected", () => { if (own()) { live.status = "online"; live.note = undefined; live.tries = 0; } });
  api.listener.on("message", (m: ZMsg) => { if (own()) void onMessage(store, ownId, m, live.groups).catch(() => undefined); });
  api.listener.on("old_messages", (msgs: ZMsg[], type: number) => { if (own()) live.onOld?.(msgs, type); });
  api.listener.on("error", (e: unknown) => { if (own()) live.note = errText(e); });
  api.listener.on("closed", (code: number) => {
    if (!own()) return;
    if (KICK_CODES.has(code)) {
      live.status = "kicked";
      live.note = "Số này đang được đăng nhập ở nơi khác (ví dụ Zalo Web). Quét QR lại để lấy lại phiên. Đăng nhập chen nhau có thể làm Zalo nghi ngờ tài khoản.";
      return;
    }
    live.status = "offline";
    live.note = "Mất kết nối tới Zalo, đang thử nối lại.";
    const delay = RECONNECT_DELAYS[live.tries];
    if (delay === undefined) { live.note = "Mất kết nối tới Zalo và không nối lại được. Quét QR lại."; live.status = "invalid"; return; }
    live.tries++;
    const t = setTimeout(() => { if (own()) void reconnect(store, channelId, deps, live.tries).catch(() => undefined); }, delay);
    (t as { unref?: () => void }).unref?.();
  });
  api.listener.start({ retryOnClose: true });
}

async function reconnect(store: Store, channelId: string, deps: ZDeps, tries = 0) {
  const db = await store.load();
  const ch = db.channels[channelId];
  const blob = db.secrets?.[sKey(channelId)];
  if (!ch || ch.off || !blob) return;
  try {
    const creds = decryptJson<ZCreds>(blob);
    const api = await (await deps.create()).login(creds);
    attach(store, channelId, ch.externalId, api, deps, groupSet(ch));
    const live = st.live.get(channelId);
    if (live) live.tries = tries;
  } catch (e) {
    const prev = st.live.get(channelId);
    st.live.set(channelId, { api: undefined, status: "invalid", note: `Phiên Zalo hết hạn hoặc bị đăng xuất, hãy quét QR lại. (${errText(e)})`, day: vnDay(nowOf(deps)), sent: prev?.sent ?? 0, nextAt: 0, chain: Promise.resolve(), tries: 0, groups: groupSet(ch) });
  }
}

// Khi máy chủ khởi động: đăng nhập lại các số đã nối (lần lượt, có nghỉ giữa các số để không đăng nhập dồn dập).
export async function resumeZaloPersonal(store: Store, deps: ZDeps = defaultDeps, gapMs = 3000) {
  if (st.resumed) return;
  st.resumed = true;
  const chans = Object.values((await store.load()).channels).filter((c) => c.kind === "zalo_personal" && !c.off);
  for (const c of chans) {
    await reconnect(store, c.id, deps).catch(() => undefined);
    if (chans.length > 1) await sleepOf(deps)(gapMs);
  }
}

// ---------- Đăng nhập bằng QR ----------
const EV = { Generated: 0, Expired: 1, Scanned: 2, Declined: 3, GotInfo: 4 };
const qrImage = (s: string) => (s.startsWith("data:") ? s : `data:image/png;base64,${s}`);

function cleanFlows(now: number) {
  for (const [id, f] of st.flows) if (now - f.at > FLOW_TTL) { f.abort?.(); st.flows.delete(id); }
}

export function getFlow(id: string): Omit<Flow, "creds" | "abort"> | null {
  cleanFlows(Date.now());
  const f = st.flows.get(id);
  if (!f) return null;
  const { creds: _c, abort: _a, ...rest } = f;
  return rest;
}

export function abortFlow(id: string): boolean {
  const f = st.flows.get(id);
  if (!f) return false;
  f.abort?.();
  st.flows.delete(id);
  return true;
}

export async function startQrFlow(store: Store, opts: { expectChannelId?: string } = {}, deps: ZDeps = defaultDeps): Promise<{ id: string }> {
  cleanFlows(nowOf(deps));
  const flow: Flow = { id: randomBytes(12).toString("hex"), status: "starting", at: nowOf(deps), expect: opts.expectChannelId };
  st.flows.set(flow.id, flow);
  void (async () => {
    try {
      const client = await deps.create();
      const api = await client.loginQR({}, (ev: any) => {
        if (ev.actions?.abort) flow.abort = ev.actions.abort;
        switch (ev.type) {
          case EV.Generated: flow.status = "qr"; flow.qr = qrImage(String(ev.data.image)); break;
          case EV.Scanned: flow.status = "scanned"; flow.name = ev.data.display_name; flow.avatar = ev.data.avatar; break;
          case EV.Expired: flow.status = "expired"; ev.actions?.abort?.(); break;
          case EV.Declined: flow.status = "declined"; ev.actions?.abort?.(); break;
          case EV.GotInfo: flow.creds = { cookie: ev.data.cookie, imei: ev.data.imei, userAgent: ev.data.userAgent }; break;
        }
      });
      if (!api) return;
      await finalize(store, flow, api, deps);
    } catch (e) {
      if (flow.status !== "expired" && flow.status !== "declined") { flow.status = "error"; flow.error = errText(e); }
    }
  })();
  return { id: flow.id };
}

async function finalize(store: Store, flow: Flow, api: ZApi, deps: ZDeps) {
  const ownId = String(api.getOwnId());
  if (!flow.creds) throw new Error("Zalo chưa trả thông tin đăng nhập");
  const creds = flow.creds;
  const { channelId, groups } = await mutate(store, (db) => {
    if (flow.expect) {
      const ex = db.channels[flow.expect];
      if (ex?.externalId && ex.externalId !== ownId) throw new Error("Quét nhầm tài khoản: kênh này là của số Zalo khác");
    }
    let ch: Channel | undefined = Object.values(db.channels).find((c) => c.kind === "zalo_personal" && c.externalId === ownId);
    if (ch) ch.off = false;
    else {
      ch = { id: `zalo_personal-${randomBytes(4).toString("hex")}`, companyId: "default", kind: "zalo_personal", externalId: ownId, name: `Zalo ${flow.name || ownId}`, sendEnabled: false }; // luôn tắt gửi khi mới nối
      db.channels[ch.id] = ch;
    }
    (db.secrets ??= {})[sKey(ch.id)] = encryptJson(creds);
    return { channelId: ch.id, groups: groupSet(ch) };
  });
  flow.channelId = channelId;
  flow.status = "done";
  flow.creds = undefined;
  attach(store, channelId, ownId, api, deps, groups);
}

// ---------- Gửi tin, hồ sơ khách, trạng thái ----------
export interface OutResult { ok: boolean; externalId?: string; error?: string }
export interface OutContent { text?: string; images?: ZSource[] }
export const MAX_IMAGES_PER_SEND = 5;

export const sendText = (channel: Channel, to: string, text: string, deps: ZDeps = defaultDeps): Promise<OutResult> => sendOut(channel, to, { text }, deps);

// Gửi chữ và/hoặc ảnh tới một khách (hoặc nhóm "g:<mã>"). Một ảnh kèm chữ đi thành một tin ảnh có chú thích; nhiều ảnh thì chữ đi trước,
// ảnh đi cùng một lượt (Zalo hiện thành bộ ảnh). Xếp hàng theo từng số, giãn cách ngẫu nhiên, hạn mức mỗi ngày tính theo số tin tạo ra.
export function sendOut(channel: Channel, to: string, content: OutContent, deps: ZDeps = defaultDeps): Promise<OutResult> {
  const live = st.live.get(channel.id);
  if (!live?.api || live.status !== "online") return Promise.resolve({ ok: false, error: "Zalo chưa đăng nhập hoặc đã mất kết nối. Quét QR lại ở Cài đặt > Kênh." });
  const api = live.api;
  const images = content.images ?? [];
  const text = content.text ?? "";
  if (images.length > MAX_IMAGES_PER_SEND) return Promise.resolve({ ok: false, error: `Mỗi lần chỉ gửi tối đa ${MAX_IMAGES_PER_SEND} ảnh` });
  if (!text && !images.length) return Promise.resolve({ ok: false, error: "Tin rỗng" });
  const group = isGroupId(to);
  const thread = group ? to.slice(GROUP_PREFIX.length) : to;
  const type = group ? 1 : 0;
  // Các lần gọi API sẽ làm, và số tin mỗi lần tạo ra
  const calls: Array<{ units: number; msg: string | { msg: string; attachments: ZSource[] } }> = [];
  if (images.length === 1) calls.push({ units: 1, msg: { msg: text, attachments: images } });
  else {
    if (text) calls.push({ units: 1, msg: text });
    if (images.length) calls.push({ units: images.length, msg: { msg: "", attachments: images } });
  }
  const total = calls.reduce((n, c) => n + c.units, 0);
  const run = live.chain.then(async (): Promise<OutResult> => {
    const day = vnDay(nowOf(deps));
    if (live.day !== day) { live.day = day; live.sent = 0; }
    if (live.sent >= dailyCap()) return { ok: false, error: `Số này đã gửi đủ ${dailyCap()} tin hôm nay. Giới hạn này để tránh bị Zalo khoá số, mai gửi tiếp.` };
    if (live.sent + total > dailyCap()) return { ok: false, error: `Số này đã gửi ${live.sent}/${dailyCap()} tin hôm nay, không đủ chỗ cho ${total} tin nữa. Giới hạn này để tránh bị Zalo khoá số, mai gửi tiếp.` };
    let last: string | undefined;
    for (let i = 0; i < calls.length; i++) {
      const wait = live.nextAt - nowOf(deps);
      if (wait > 0) await sleepOf(deps)(wait);
      try {
        const r = await api.sendMessage(calls[i].msg, thread, type);
        live.sent += calls[i].units;
        live.nextAt = nowOf(deps) + MIN_GAP_MS + Math.floor((deps.random ?? Math.random)() * JITTER_MS);
        const id = r.attachment?.length ? r.attachment[r.attachment.length - 1].msgId : r.message?.msgId;
        if (id != null) last = String(id);
      } catch (e) {
        const done = i > 0 ? " Phần chữ đã gửi, ảnh chưa gửi được." : "";
        return { ok: false, externalId: last, error: `Zalo không gửi được: ${errText(e)}.${done}` };
      }
    }
    return { ok: true, externalId: last };
  });
  live.chain = run.catch(() => undefined);
  return run;
}

// Hồ sơ khách: người dùng (tên, ảnh) hoặc nhóm "g:<mã>" (tên nhóm, ảnh nhóm)
export async function fetchZaloProfile(channel: Channel, uid: string): Promise<{ name?: string; avatarUrl?: string } | null> {
  const api = st.live.get(channel.id)?.api;
  if (!api) return null;
  try {
    if (isGroupId(uid)) {
      const gid = uid.slice(GROUP_PREFIX.length);
      const g = (await api.getGroupInfo(gid)).gridInfoMap?.[gid];
      const name = g?.name?.trim();
      if (!name && !g?.avt) return null;
      return { name: name || undefined, avatarUrl: g?.avt || undefined };
    }
    const r = await api.getUserInfo(uid);
    const p = r.changed_profiles?.[uid];
    const name = (p?.displayName || p?.zaloName || p?.username)?.trim();
    if (!name && !p?.avatar) return null;
    return { name: name || undefined, avatarUrl: p?.avatar || undefined };
  } catch {
    return null;
  }
}

// ---------- Nhóm chat: liệt kê và bật/tắt từng nhóm ----------
export interface GroupRow { id: string; name: string; members?: number; avatar?: string; enabled: boolean }

export async function listZaloGroups(channel: Channel): Promise<{ ok: true; groups: GroupRow[] } | { ok: false; error: string }> {
  const live = st.live.get(channel.id);
  if (!live?.api || live.status !== "online") return { ok: false, error: "Zalo chưa đăng nhập hoặc đã mất kết nối. Quét QR lại trước." };
  try {
    const ids = Object.keys((await live.api.getAllGroups()).gridVerMap ?? {});
    const rows: GroupRow[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const info = (await live.api.getGroupInfo(ids.slice(i, i + 50))).gridInfoMap ?? {};
      for (const id of ids.slice(i, i + 50)) rows.push({ id, name: info[id]?.name?.trim() || `Nhóm ${id}`, members: info[id]?.totalMember, avatar: info[id]?.avt || undefined, enabled: live.groups.has(id) });
    }
    // Nhóm đang bật mà Zalo không còn trả về (đã rời nhóm) vẫn hiện để tắt được
    for (const id of live.groups) if (!rows.some((r) => r.id === id)) rows.push({ id, name: `Nhóm ${id} (không còn trong danh sách)`, enabled: true });
    rows.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name, "vi"));
    return { ok: true, groups: rows };
  } catch (e) {
    return { ok: false, error: `Không lấy được danh sách nhóm: ${errText(e)}` };
  }
}

// Ghi danh sách nhóm được bật (thay hẳn danh sách cũ). Áp dụng ngay cho phiên đang nghe.
export async function setZaloGroups(store: Store, channelId: string, ids: string[]): Promise<{ ok: boolean; error?: string; groups?: string[] }> {
  const clean = [...new Set(ids.map(String))];
  if (clean.some((x) => !/^\d+$/.test(x))) return { ok: false, error: "Mã nhóm không hợp lệ" };
  if (clean.length > MAX_GROUPS) return { ok: false, error: `Chỉ bật tối đa ${MAX_GROUPS} nhóm` };
  const found = await mutate(store, (db) => {
    const ch = db.channels[channelId];
    if (!ch || ch.kind !== "zalo_personal") return false;
    const meta = { ...(ch.meta ?? {}) };
    if (clean.length) meta.groups = clean.join(","); else delete meta.groups;
    ch.meta = Object.keys(meta).length ? meta : undefined;
    return true;
  });
  if (!found) return { ok: false, error: "Không tìm thấy kênh Zalo cá nhân" };
  const live = st.live.get(channelId);
  if (live) live.groups = new Set(clean);
  return { ok: true, groups: clean };
}

// Dành cho tải tin cũ (zalohistory.ts): phiên đang nghe của một số
export function zaloLive(channelId: string): { api: ZApi; groups: ReadonlySet<string>; setOld: (cb?: (msgs: ZMsg[], type: number) => void) => void } | null {
  const live = st.live.get(channelId);
  if (!live?.api || live.status !== "online") return null;
  return { api: live.api, groups: live.groups, setOld: (cb) => { live.onOld = cb; } };
}

export function zaloPersonalState(channelId: string): { status: Status; note?: string } | null {
  const l = st.live.get(channelId);
  return l ? { status: l.status, note: l.note } : null;
}

export function stopZaloPersonal(channelId: string) {
  st.live.get(channelId)?.api?.listener.stop();
  st.live.delete(channelId);
}

export const hasZaloSession = async (store: Store, channelId: string) => !!(await store.load()).secrets?.[sKey(channelId)];
export const zaloSessionKey = sKey;
