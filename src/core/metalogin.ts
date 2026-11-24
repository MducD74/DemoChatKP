// Nối Facebook bằng đăng nhập: quản trị Page đăng nhập một lần, KP Chat liệt kê các Page họ quản lý rồi nối những Page được chọn.
// Đã đối chiếu tài liệu Meta (manual flow, long-lived token, /{user}/accounts, quyền Messenger và Instagram), Graph API v27.0.
// CHƯA XÁC MINH: tên trường Instagram liên kết trên Page (dùng instagram_business_account), danh sách quyền cần Advanced Access.
import { mutate, type Store } from "./store";
import { decryptJson, encryptJson } from "./secret";
import { staticTokens } from "./token-store";
import { subscribeMetaPage } from "./connect";
import type { Channel } from "./types";

const GRAPH = "https://graph.facebook.com/v27.0";
const DIALOG = "https://www.facebook.com/v27.0/dialog/oauth";
// Quyền cần cho Messenger và Instagram (tài liệu Meta). Dùng khi không có Configuration ID của Facebook Login for Business.
export const LOGIN_SCOPES = ["pages_show_list", "pages_messaging", "pages_manage_metadata", "pages_read_engagement", "business_management", "instagram_basic", "instagram_manage_messages"];
const SESSION_TTL = 15 * 60 * 1000;

// rerequest: hỏi lại quyền và Page được chia sẻ, dùng khi muốn thêm Page mới mà Facebook không hiện lại hộp chọn
export interface LoginCfg { appId: string; appSecret: string; redirectUri: string; configId?: string; rerequest?: boolean }

export function metaLoginUrl(cfg: LoginCfg, state: string): string {
  const p = new URLSearchParams({ client_id: cfg.appId, redirect_uri: cfg.redirectUri, state, response_type: "code" });
  // Facebook Login for Business: config_id thay cho scope (khuyến nghị của Meta)
  if (cfg.configId) p.set("config_id", cfg.configId);
  else p.set("scope", LOGIN_SCOPES.join(","));
  if (cfg.rerequest) p.set("auth_type", "rerequest");
  return `${DIALOG}?${p}`;
}

type Json = Record<string, unknown>;
async function getJson(f: typeof fetch, url: string, token?: string): Promise<{ ok: boolean; j: Json }> {
  const r = await f(url, token ? { headers: { authorization: `Bearer ${token}` } } : undefined);
  return { ok: r.ok, j: (await r.json().catch(() => ({}))) as Json };
}
const errText = (j: Json) => ((j.error as { message?: string } | undefined)?.message ?? "lỗi không rõ");

// Đổi mã đăng nhập lấy token người dùng, rồi đổi tiếp sang token dài hạn (khoảng 60 ngày) để token Page lấy ra không hết hạn.
export async function exchangeLogin(cfg: LoginCfg, code: string, f: typeof fetch = fetch): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const a = await getJson(f, `${GRAPH}/oauth/access_token?${new URLSearchParams({ client_id: cfg.appId, redirect_uri: cfg.redirectUri, client_secret: cfg.appSecret, code })}`);
  const short = a.j.access_token as string | undefined;
  if (!a.ok || !short) return { ok: false, error: `Meta từ chối mã đăng nhập: ${errText(a.j)}` };
  const b = await getJson(f, `${GRAPH}/oauth/access_token?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: cfg.appId, client_secret: cfg.appSecret, fb_exchange_token: short })}`);
  const long = b.j.access_token as string | undefined;
  if (!b.ok || !long) return { ok: false, error: `Không đổi được sang token dài hạn: ${errText(b.j)}` };
  return { ok: true, token: long };
}

export interface MetaPage { id: string; name: string; token: string; tasks?: string[]; ig?: { id: string; username?: string } }

// Liệt kê các Page người đăng nhập có quyền, kèm token Page. Theo trang kế tiếp tối đa 5 lần.
export async function listPages(userToken: string, f: typeof fetch = fetch): Promise<{ ok: true; pages: MetaPage[] } | { ok: false; error: string }> {
  const fields = "id,name,access_token,tasks,instagram_business_account{id,username}";
  let url: string | undefined = `${GRAPH}/me/accounts?${new URLSearchParams({ fields, limit: "100" })}`;
  const pages: MetaPage[] = [];
  for (let i = 0; url && i < 5; i++) {
    const r = await getJson(f, url, userToken);
    if (!r.ok) return { ok: false, error: `Không lấy được danh sách Page: ${errText(r.j)}` };
    for (const p of (r.j.data as Array<Record<string, unknown>> | undefined) ?? []) {
      if (typeof p.id !== "string" || typeof p.access_token !== "string") continue;
      const ig = p.instagram_business_account as { id?: string; username?: string } | undefined;
      pages.push({ id: p.id, name: String(p.name ?? p.id), token: p.access_token, tasks: Array.isArray(p.tasks) ? (p.tasks as string[]) : undefined, ig: ig?.id ? { id: ig.id, username: ig.username } : undefined });
    }
    const next = (r.j.paging as { next?: string } | undefined)?.next;
    url = next && next.startsWith(`${GRAPH}/`) ? next : undefined; // chỉ đi theo địa chỉ của Graph API
  }
  return { ok: true, pages };
}

// Page phải cho người đăng nhập tác vụ MESSAGING (tài liệu Messenger). Không có thông tin tác vụ thì cho thử.
export const canMessage = (p: Pick<MetaPage, "tasks">) => !p.tasks || p.tasks.includes("MESSAGING");

// ---------- Chẩn đoán đăng nhập: vì sao Page nào đó không hiện trong danh sách ----------
// Hỏi Meta hai điều (chỉ đọc): token này đã được cấp những quyền nào (/me/permissions) và người dùng đã chia sẻ những Page nào
// (debug_token > granular_scopes > target_ids). So với danh sách /me/accounts để biết Page thiếu là do chưa chia sẻ hay do Meta không trả về.
// Không chứa token. CHƯA XÁC MINH với Meta thật: dạng phản hồi của debug_token với Facebook Login for Business (code đọc linh hoạt, lỗi thì bỏ qua).
export interface LoginDiag {
  granted: string[]; declined: string[];
  sharedPageIds: string[]; // Page người dùng đã chia sẻ cho app (theo granular_scopes); rỗng nếu Meta không cho biết
  returned: number; // số Page /me/accounts trả về
  missing: string[]; // đã chia sẻ nhưng /me/accounts không trả về
  usedConfigId: boolean; rerequest: boolean;
  error?: string;
}
export async function diagnoseLogin(cfg: LoginCfg, userToken: string, returnedIds: string[], f: typeof fetch = fetch): Promise<LoginDiag> {
  const d: LoginDiag = { granted: [], declined: [], sharedPageIds: [], returned: returnedIds.length, missing: [], usedConfigId: !!cfg.configId, rerequest: !!cfg.rerequest };
  try {
    const perms = await getJson(f, `${GRAPH}/me/permissions`, userToken);
    for (const p of (perms.j.data as Array<{ permission?: string; status?: string }> | undefined) ?? []) {
      if (!p.permission) continue;
      (p.status === "granted" ? d.granted : d.declined).push(p.permission);
    }
    if (!perms.ok) d.error = `me/permissions: ${errText(perms.j)}`;
    const dbg = await getJson(f, `${GRAPH}/debug_token?${new URLSearchParams({ input_token: userToken })}`, `${cfg.appId}|${cfg.appSecret}`);
    const data = dbg.j.data as { granular_scopes?: Array<{ scope?: string; target_ids?: unknown[] }> } | undefined;
    const ids = new Set<string>();
    for (const g of data?.granular_scopes ?? []) {
      if (g.scope && /^pages_/.test(g.scope)) for (const t of g.target_ids ?? []) ids.add(String(t));
    }
    d.sharedPageIds = [...ids];
    d.missing = d.sharedPageIds.filter((x) => !returnedIds.includes(x));
    if (!dbg.ok) d.error = `${d.error ? d.error + "; " : ""}debug_token: ${errText(dbg.j)}`;
  } catch (e) {
    d.error = e instanceof Error ? e.message : "không gọi được Meta";
  }
  return d;
}

// Câu nhật ký một dòng (không token, không nội dung hội thoại)
export const diagLine = (d: LoginDiag) =>
  `[meta-login] trả về ${d.returned} Page; chia sẻ ${d.sharedPageIds.length}; thiếu ${d.missing.length}${d.missing.length ? ` (${d.missing.join(",")})` : ""}; quyền đã cấp: ${d.granted.join(",") || "?"}; từ chối: ${d.declined.join(",") || "không"}; config_id=${d.usedConfigId} rerequest=${d.rerequest}${d.error ? `; lỗi chẩn đoán: ${d.error}` : ""}`;

// ---------- Phiên chọn Page (token Page lưu mã hóa, hết hạn sau 15 phút, dùng một lần) ----------
const pk = (id: string) => `meta-pick:${id}`;
export async function createPickSession(store: Store, pages: MetaPage[], now = Date.now(), diag?: LoginDiag): Promise<string> {
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  await mutate(store, (db) => { (db.secrets ??= {})[pk(id)] = encryptJson({ at: now, pages, diag }); });
  return id;
}
// Chẩn đoán của phiên chọn (để giao diện giải thích Page thiếu). Không có thì null.
export async function readPickDiag(store: Store, id: string, now = Date.now()): Promise<LoginDiag | null> {
  const blob = (await store.load()).secrets?.[pk(id)];
  if (!blob) return null;
  const s = decryptJson<{ at: number; diag?: LoginDiag }>(blob);
  return now - s.at <= SESSION_TTL ? s.diag ?? null : null;
}
export async function readPickSession(store: Store, id: string, now = Date.now()): Promise<MetaPage[] | null> {
  const blob = (await store.load()).secrets?.[pk(id)];
  if (!blob) return null;
  const s = decryptJson<{ at: number; pages: MetaPage[] }>(blob);
  return now - s.at <= SESSION_TTL ? s.pages : null;
}
const dropSession = (store: Store, id: string) => mutate(store, (db) => { delete db.secrets?.[pk(id)]; });

// Bản gửi cho giao diện: không có token, kèm tình trạng đã nối chưa
export async function pagesForUi(store: Store, id: string, now = Date.now()) {
  const pages = await readPickSession(store, id, now);
  if (!pages) return null;
  const db = await store.load();
  const have = (kind: string, ext: string) => Object.values(db.channels).find((c) => c.kind === kind && c.externalId === ext && !c.off);
  return pages.map((p) => ({
    id: p.id, name: p.name, tasks: p.tasks, canMessage: canMessage(p), ig: p.ig,
    connected: !!have("facebook", p.id), igConnected: !!(p.ig && have("instagram", p.ig.id)),
  }));
}

// ---------- Nối các Page đã chọn ----------
export interface PickResult { id: string; name: string; kind: "facebook" | "instagram"; ok: boolean; note: string }
export async function connectPages(
  store: Store, sessionId: string, picks: Array<{ pageId: string; instagram?: boolean }>, f: typeof fetch = fetch, now = Date.now()
): Promise<{ ok: true; results: PickResult[] } | { ok: false; error: string }> {
  const pages = await readPickSession(store, sessionId, now);
  if (!pages) return { ok: false, error: "Phiên chọn Page đã hết hạn, hãy đăng nhập Facebook lại" };
  const st = staticTokens(store);
  const results: PickResult[] = [];
  for (const pick of picks) {
    const p = pages.find((x) => x.id === pick.pageId);
    if (!p) { results.push({ id: pick.pageId, name: pick.pageId, kind: "facebook", ok: false, note: "Page không có trong danh sách" }); continue; }
    if (!canMessage(p)) { results.push({ id: p.id, name: p.name, kind: "facebook", ok: false, note: "Tài khoản đăng nhập chưa có quyền Nhắn tin trên Page này" }); continue; }
    const targets: Array<{ kind: "facebook" | "instagram"; externalId: string; name: string }> = [{ kind: "facebook", externalId: p.id, name: p.name }];
    if (pick.instagram && p.ig) targets.push({ kind: "instagram", externalId: p.ig.id, name: `${p.name} (Instagram${p.ig.username ? ` @${p.ig.username}` : ""})` });
    for (const t of targets) {
      // Đã có kênh thì chỉ cập nhật token; từng gỡ kết nối thì mở lại kênh cũ (giữ lịch sử, tắt gửi tin); chưa có thì tạo (luôn tắt gửi tin)
      let revived = false;
      const id = await mutate(store, (db) => {
        const same = Object.values(db.channels).filter((c) => c.kind === t.kind && c.externalId === t.externalId);
        const ex = same.find((c) => !c.off);
        if (ex) return ex.id;
        const old = same[0];
        if (old) {
          old.off = false; old.sendEnabled = false; old.name = t.name;
          if (t.kind === "instagram") old.meta = { ...old.meta, pageId: p.id };
          revived = true;
          return old.id;
        }
        const ch: Channel = { id: `${t.kind}-${Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("")}`, companyId: "default", kind: t.kind, externalId: t.externalId, name: t.name, sendEnabled: false, ...(t.kind === "instagram" ? { meta: { pageId: p.id } } : {}) };
        db.channels[ch.id] = ch;
        return ch.id;
      });
      await st.save(id, p.token); // Instagram liên kết Page dùng chung token Page
      const sub = await subscribeMetaPage(p.id, p.token, f);
      console.info(`[meta-login] nối ${t.kind} ${t.externalId} (${revived ? "mở lại kênh cũ" : "kênh mới hoặc cập nhật token"}); đăng ký nhận tin: ${sub.ok ? "được" : sub.error}`);
      const pre = revived ? "Đã nối lại kênh cũ (giữ lịch sử, gửi tin đang tắt)" : "Đã nối";
      results.push({ id: t.externalId, name: t.name, kind: t.kind, ok: true, note: sub.ok ? `${pre} và đăng ký nhận tin` : `${pre} nhưng chưa đăng ký nhận tin (${sub.error}). Thử lại ở thẻ kênh.` });
    }
  }
  await dropSession(store, sessionId);
  return { ok: true, results };
}
