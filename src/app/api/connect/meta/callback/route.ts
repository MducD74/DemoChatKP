import { NextResponse } from "next/server";
import { actorOf, boot, loginBase, store } from "@/server";
import { consumeOAuth } from "@/core/connect";
import { isAdmin } from "@/core/policy";
import { createPickSession, diagLine, diagnoseLogin, exchangeLogin, listPages } from "@/core/metalogin";

// Meta chuyển hướng về đây: ?code=...&state=... hoặc ?error=access_denied&error_reason=user_denied
export async function GET(req: Request) {
  boot();
  const sp = new URL(req.url).searchParams;
  const back = (q: string) => NextResponse.redirect(`${loginBase(req)}/?tab=set&${q}`);
  // Mọi lỗi đăng nhập đều ghi nhật ký máy chủ (không token) để lần ra khi nối Page không ổn
  const fail = (m: string) => { console.warn(`[meta-login] thất bại: ${m}`); return back("error=" + encodeURIComponent(m)); };
  if (!isAdmin(actorOf(req))) return fail("Chỉ quản trị mới nối được kênh");
  if (sp.get("error")) return fail(sp.get("error_reason") === "user_denied" ? "Bạn đã hủy đăng nhập Facebook" : `Facebook báo lỗi: ${sp.get("error_description") ?? sp.get("error")}`);
  const code = sp.get("code"), state = sp.get("state");
  if (!code || !state) return fail("Facebook không trả đủ code và state");
  const st = await consumeOAuth(store, state, "facebook");
  if (!st) return fail("Phiên đăng nhập hết hạn hoặc không hợp lệ, hãy thử lại");
  const appId = process.env.META_APP_ID, appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) return fail("Chưa cấu hình ứng dụng Meta");
  const cfg = { appId, appSecret, redirectUri: `${loginBase(req)}/api/connect/meta/callback`, configId: process.env.META_LOGIN_CONFIG_ID };
  const t = await exchangeLogin(cfg, code);
  if (!t.ok) return fail(t.error);
  const pages = await listPages(t.token);
  if (!pages.ok) return fail(pages.error);
  // Chẩn đoán: quyền đã cấp và Page đã chia sẻ so với danh sách Meta trả về (chỉ đọc, lỗi thì bỏ qua)
  const diag = await diagnoseLogin({ ...cfg, rerequest: !!st.rerequest }, t.token, pages.pages.map((p) => p.id));
  console.info(diagLine(diag));
  if (!pages.pages.length) return fail(`Tài khoản này không quản lý Page nào, hoặc chưa cấp quyền xem danh sách Page${diag.sharedPageIds.length ? ` (Facebook báo đã chia sẻ ${diag.sharedPageIds.length} Page nhưng không trả về)` : ""}`);
  return back("meta=" + (await createPickSession(store, pages.pages, Date.now(), diag)));
}
