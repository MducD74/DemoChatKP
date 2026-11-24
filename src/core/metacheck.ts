// Kiểm tra cài đặt Meta và tự cấu hình webhook cho ứng dụng. Chỉ đọc/ghi qua Graph API v27.0 khi quản trị bấm nút.
// Đã đối chiếu tài liệu: /{app-id}/subscriptions (POST/GET), /{page-id}/subscribed_apps (GET), bắt tay xác minh webhook.
// CHƯA XÁC MINH: định dạng token ứng dụng "app_id|app_secret" (dạng chuẩn của Meta nhưng trang tham chiếu không nêu), cấu trúc JSON của GET subscriptions
// (code đọc linh hoạt), Instagram không đăng ký được bằng API (tài liệu nói phải làm ở App Dashboard).
import type { Store } from "./store";
import { staticTokens } from "./token-store";

const GRAPH = "https://graph.facebook.com/v27.0";
export const PAGE_FIELDS = ["messages", "message_echoes", "messaging_postbacks"];

export interface MetaEnv {
  META_APP_ID?: string; META_APP_SECRET?: string; META_VERIFY_TOKEN?: string; META_LOGIN_CONFIG_ID?: string;
  KPCHAT_PUBLIC_URL?: string; KPCHAT_ACCESS_KEY?: string; KPCHAT_SECRET_KEY?: string;
}
export type Level = "ok" | "warn" | "bad" | "info";
export interface Check { id: string; level: Level; title: string; detail: string }

type Json = Record<string, unknown>;
async function call(f: typeof fetch, url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; j: Json; text: string }> {
  try {
    const r = await f(url, init);
    const text = await r.text();
    let j: Json = {};
    try { j = JSON.parse(text) as Json; } catch { /* không phải JSON */ }
    return { ok: r.ok, status: r.status, j, text };
  } catch (e) {
    return { ok: false, status: 0, j: {}, text: e instanceof Error ? e.message : "lỗi mạng" };
  }
}
const errMsg = (j: Json) => (j.error as { message?: string } | undefined)?.message ?? "";
// Token ứng dụng dạng app_id|app_secret (không bao giờ ghi ra log hay trả về giao diện)
const appToken = (env: MetaEnv) => `${env.META_APP_ID}|${env.META_APP_SECRET}`;

export const webhookUrl = (env: MetaEnv) => `${(env.KPCHAT_PUBLIC_URL ?? "").replace(/\/$/, "")}/api/webhook/facebook`;

// Tự cấu hình webhook của ứng dụng cho đối tượng Page. Meta sẽ gọi GET xác minh về địa chỉ ngay lúc này.
export async function configureWebhook(env: MetaEnv, f: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!env.META_APP_ID || !env.META_APP_SECRET || !env.META_VERIFY_TOKEN) return { ok: false, error: "Thiếu META_APP_ID, META_APP_SECRET hoặc META_VERIFY_TOKEN" };
  if (!/^https:\/\//.test(env.KPCHAT_PUBLIC_URL ?? "")) return { ok: false, error: "Cần địa chỉ công khai HTTPS (KPCHAT_PUBLIC_URL)" };
  const body = new URLSearchParams({ object: "page", callback_url: webhookUrl(env), fields: PAGE_FIELDS.join(","), verify_token: env.META_VERIFY_TOKEN, access_token: appToken(env) });
  const r = await call(f, `${GRAPH}/${env.META_APP_ID}/subscriptions`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() });
  if (r.ok && (r.j.success === true || r.j.success === "true")) return { ok: true };
  return { ok: false, error: `Meta từ chối: ${errMsg(r.j) || r.text.slice(0, 160) || r.status}` };
}

// Đọc linh hoạt vì chưa có ví dụ phản hồi chính thức: fields có thể là mảng chuỗi hoặc mảng {name}
function pageSubscription(j: Json): { callback?: string; fields: string[]; active?: boolean } | null {
  const data = (j.data as Array<Record<string, unknown>> | undefined) ?? [];
  const s = data.find((d) => d.object === "page");
  if (!s) return null;
  const fields = ((s.fields as unknown[]) ?? []).map((x) => (typeof x === "string" ? x : String((x as { name?: string })?.name ?? "")));
  return { callback: s.callback_url as string | undefined, fields, active: s.active as boolean | undefined };
}

export async function runChecks(store: Store, env: MetaEnv, f: typeof fetch = fetch): Promise<Check[]> {
  const out: Check[] = [];
  const add = (id: string, level: Level, title: string, detail: string) => out.push({ id, level, title, detail });
  const pub = (env.KPCHAT_PUBLIC_URL ?? "").replace(/\/$/, "");

  // 1. Biến môi trường
  const missing = (["META_APP_ID", "META_APP_SECRET", "META_VERIFY_TOKEN"] as const).filter((k) => !env[k]);
  if (missing.length) add("env", "bad", "Thiếu khóa ứng dụng Meta ở máy chủ", `Chưa đặt ${missing.join(", ")} trong .env.local. Lấy App ID và App Secret ở Meta: App settings > Basic. Sau đó khởi động lại KP Chat.`);
  else add("env", "ok", "Đã có khóa ứng dụng Meta", "META_APP_ID, META_APP_SECRET, META_VERIFY_TOKEN đã được đặt.");

  // 2. Địa chỉ công khai và khóa truy cập
  if (!pub) add("public", "bad", "Chưa có địa chỉ công khai", "Điền KPCHAT_PUBLIC_URL (địa chỉ https của đường hầm hoặc máy chủ) trong .env.local rồi khởi động lại.");
  else if (!pub.startsWith("https://")) add("public", "bad", "Địa chỉ công khai phải là https", `Hiện là ${pub}. Meta chỉ gọi địa chỉ https công khai.`);
  else if (/localhost|127\.0\.0\.1/.test(pub)) add("public", "bad", "Địa chỉ công khai đang là localhost", "Meta không gọi được localhost. Dùng địa chỉ của đường hầm hoặc máy chủ.");
  else add("public", "ok", "Có địa chỉ công khai https", pub);
  if (pub && (!env.KPCHAT_ACCESS_KEY || env.KPCHAT_ACCESS_KEY.length < 16)) add("key", "bad", "Chưa có khóa truy cập", "Đang mở ra Internet mà chưa đặt KPCHAT_ACCESS_KEY (tối thiểu 16 ký tự). Người lạ có thể vào làm quản trị.");
  if (!env.KPCHAT_SECRET_KEY) add("seckey", "warn", "Đang dùng khóa mã hóa tạm", "Chưa đặt KPCHAT_SECRET_KEY: token lưu bằng khóa tạm. Chỉ chấp nhận khi thử trên máy.");

  // 3. Meta có truy cập được webhook của mình không (đúng cách Meta xác minh)
  if (pub.startsWith("https://") && env.META_VERIFY_TOKEN) {
    const ch = `kpchat-${Date.now()}`;
    const r = await call(f, `${webhookUrl(env)}?${new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": env.META_VERIFY_TOKEN, "hub.challenge": ch })}`);
    if (r.ok && r.text === ch) add("reach", "ok", "Webhook truy cập được từ bên ngoài", "Gọi thử địa chỉ webhook qua địa chỉ công khai và nhận đúng phản hồi xác minh, như Meta sẽ làm.");
    else if (r.status === 0) add("reach", "bad", "Không gọi được địa chỉ công khai", `Đường hầm có thể chưa chạy hoặc đã đổi địa chỉ (${r.text}). Chạy lại đường hầm và cập nhật KPCHAT_PUBLIC_URL.`);
    else if (r.status === 401 || r.status === 503) add("reach", "bad", "Cổng khóa truy cập chặn webhook", `Phản hồi ${r.status}. Webhook phải được miễn khóa; hãy báo lỗi này cho người phát triển.`);
    else if (r.status === 404) add("reach", "bad", "Địa chỉ webhook chưa hoạt động", "KP Chat trả 404: thường là chưa khởi động lại sau khi điền META_APP_SECRET và META_VERIFY_TOKEN.");
    else add("reach", "bad", "Webhook trả lời sai", `Phản hồi ${r.status}. Kiểm tra META_VERIFY_TOKEN và khởi động lại.`);
  }

  // 4. Khóa ứng dụng có hợp lệ không
  if (!missing.length) {
    const r = await call(f, `${GRAPH}/${env.META_APP_ID}?${new URLSearchParams({ fields: "name", access_token: appToken(env) })}`);
    if (r.ok && r.j.name) add("app", "ok", `Ứng dụng Meta: ${String(r.j.name)}`, "App ID và App Secret được Meta chấp nhận.");
    else add("app", "bad", "Meta không chấp nhận App ID hoặc App Secret", `${errMsg(r.j) || r.status}. Kiểm tra lại hai giá trị ở App settings > Basic.`);

    // 5. Webhook của ứng dụng (đối tượng Page)
    const s = await call(f, `${GRAPH}/${env.META_APP_ID}/subscriptions?${new URLSearchParams({ access_token: appToken(env) })}`);
    if (!s.ok) add("sub", "warn", "Chưa đọc được cấu hình webhook của ứng dụng", `${errMsg(s.j) || s.status}. Có thể bấm Tự cấu hình webhook, hoặc cấu hình tay ở Meta: Webhooks > Page.`);
    else {
      const sub = pageSubscription(s.j);
      const need = PAGE_FIELDS.filter((x) => !sub?.fields.includes(x));
      if (!sub) add("sub", "bad", "Ứng dụng chưa có webhook cho Page", "Bấm Tự cấu hình webhook (cần địa chỉ công khai đang chạy), hoặc cấu hình tay ở Meta: Webhooks > Page.");
      else if (pub && sub.callback && sub.callback.replace(/\/$/, "") !== webhookUrl(env)) add("sub", "bad", "Webhook đang trỏ về địa chỉ khác", `Meta đang gọi ${sub.callback}, trong khi địa chỉ hiện tại là ${webhookUrl(env)}. Bấm Tự cấu hình webhook để cập nhật (thường do đường hầm đổi địa chỉ).`);
      else if (sub.active === false) add("sub", "bad", "Webhook đang bị tắt", "Meta báo subscription không hoạt động (thường do máy chủ không trả lời trong thời gian dài). Bấm Tự cấu hình webhook để bật lại.");
      else if (need.length) add("sub", "warn", "Webhook thiếu một số trường", `Chưa đăng ký: ${need.join(", ")}. Thiếu message_echoes thì KP Chat không biết khi nhân viên trả lời từ ngoài. Bấm Tự cấu hình webhook.`);
      else add("sub", "ok", "Webhook của ứng dụng đã cấu hình", `Đăng ký ${PAGE_FIELDS.join(", ")}.`);
    }
  }

  // 6. Từng Page đã nối: token còn hiệu lực và đã đăng ký ứng dụng nhận tin chưa
  const db = await store.load();
  const st = staticTokens(store);
  const pages = Object.values(db.channels).filter((c) => c.kind === "facebook" && !c.off);
  if (!pages.length) add("pages", "info", "Chưa nối Page nào", "Dùng nút Đăng nhập Facebook để chọn Page.");
  for (const c of pages) {
    const tok = await st.get(c.id);
    if (!tok) { add(`page-${c.id}`, "bad", `${c.name}: chưa có token`, "Đăng nhập Facebook lại để cấp token cho Page này."); continue; }
    const r = await call(f, `${GRAPH}/${c.externalId}/subscribed_apps`, { headers: { authorization: `Bearer ${tok}` } });
    if (!r.ok) { add(`page-${c.id}`, "bad", `${c.name}: token không còn dùng được`, `${errMsg(r.j) || r.status}. Đăng nhập Facebook lại để cập nhật token.`); continue; }
    const apps = (r.j.data as Array<{ id?: string; subscribed_fields?: string[] }> | undefined) ?? [];
    const mine = env.META_APP_ID ? apps.find((a) => String(a.id) === env.META_APP_ID) : undefined;
    if (!mine) add(`page-${c.id}`, "bad", `${c.name}: chưa đăng ký nhận tin`, "Ứng dụng chưa được cài vào Page này. Mở thẻ kênh và bấm Đăng ký nhận tin, hoặc nối lại bằng Đăng nhập Facebook.");
    else if (!mine.subscribed_fields?.includes("messages")) add(`page-${c.id}`, "bad", `${c.name}: chưa đăng ký trường messages`, "Bấm Đăng ký nhận tin ở thẻ kênh.");
    else add(`page-${c.id}`, "ok", `${c.name}: sẵn sàng nhận tin`, `Token còn dùng được, đã đăng ký: ${(mine.subscribed_fields ?? []).join(", ")}.`);
  }
  // 7. Instagram: token dùng chung với Page liên kết; Page phải đăng ký nhận tin của app (Instagram đi qua Page)
  const igs = Object.values(db.channels).filter((c) => c.kind === "instagram" && !c.off);
  for (const c of igs) {
    const tok = await st.get(c.id);
    if (!tok) { add(`ig-${c.id}`, "bad", `${c.name}: chưa có token`, "Nối lại bằng Đăng nhập Facebook (chọn cả Instagram liên kết) để cấp token."); continue; }
    if (!c.meta?.pageId) { add(`ig-${c.id}`, "bad", `${c.name}: thiếu Page liên kết`, "Kênh Instagram cần mã Page liên kết để gửi tin. Nối lại bằng Đăng nhập Facebook."); continue; }
    const r = await call(f, `${GRAPH}/${c.meta.pageId}/subscribed_apps`, { headers: { authorization: `Bearer ${tok}` } });
    if (!r.ok) { add(`ig-${c.id}`, "bad", `${c.name}: token không còn dùng được`, `${errMsg(r.j) || r.status}. Đăng nhập Facebook lại để cập nhật token.`); continue; }
    const apps = (r.j.data as Array<{ id?: string; subscribed_fields?: string[] }> | undefined) ?? [];
    const mine = env.META_APP_ID ? apps.find((a) => String(a.id) === env.META_APP_ID) : undefined;
    if (!mine || !mine.subscribed_fields?.includes("messages")) add(`ig-${c.id}`, "bad", `${c.name}: Page liên kết chưa đăng ký nhận tin`, "Instagram nhận tin qua Page liên kết: ứng dụng phải đăng ký trường messages trên Page. Nối lại bằng Đăng nhập Facebook.");
    else add(`ig-${c.id}`, "ok", `${c.name}: Page liên kết đã đăng ký nhận tin`, "Còn hai việc Meta không cho kiểm bằng API: bật \"Cho phép truy cập tin nhắn\" ở tài khoản Instagram và cấu hình webhook Instagram (xem bên dưới).");
  }
  if (igs.length) add("ig", "info", "Instagram: webhook làm ở App Dashboard", "Meta không cho đăng ký webhook Instagram qua API. (1) Ở app Instagram của tài khoản chuyên nghiệp: Cài đặt > Tin nhắn và phản hồi tin cá nhân > Điều khiển tin nhắn > Công cụ được kết nối > bật Cho phép truy cập tin nhắn. (2) Ở Meta for Developers: Webhooks > chọn Instagram (hoặc Messenger > Cài đặt Instagram), Callback URL = địa chỉ công khai + /api/webhook/instagram, Verify Token = META_VERIFY_TOKEN, đăng ký trường messages; app phải ở trạng thái đã đăng (Published) mới nhận webhook. Hướng dẫn từng bước: docs/KET-NOI-META.md, phần Instagram.");
  return out;
}
