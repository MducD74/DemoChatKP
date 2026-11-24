import { NextResponse } from "next/server";
import { baseUrl, boot, store, tiktokAdapter } from "@/server";
import { consumeOAuth, setChannelExternalId } from "@/core/connect";

// TikTok chuyển hướng về đây: ?code=<auth_code>&state=...
export async function GET(req: Request) {
  boot();
  const sp = new URL(req.url).searchParams;
  const back = (q: string) => NextResponse.redirect(`${baseUrl(req)}/?tab=set&${q}`);
  const code = sp.get("code"), state = sp.get("state");
  if (!code || !state) return back("error=" + encodeURIComponent("TikTok không trả code hoặc state (có thể tài khoản đã cấp quyền trước đó: thêm &disable_auto_auth=1 vào link cấp quyền)"));
  const st = await consumeOAuth(store, state, "tiktok");
  if (!st) return back("error=" + encodeURIComponent("Phiên cấp quyền hết hạn hoặc không hợp lệ, hãy thử lại"));
  const t = tiktokAdapter();
  if (!t) return back("error=" + encodeURIComponent("Chưa cấu hình TikTok"));
  const r = await t.connect(st.channelId, code, `${baseUrl(req)}/api/connect/tiktok/callback`);
  if (!r) return back("error=" + encodeURIComponent("TikTok từ chối mã cấp quyền"));
  await setChannelExternalId(store, st.channelId, r.openId);
  return back("connected=" + encodeURIComponent(st.channelId));
}
