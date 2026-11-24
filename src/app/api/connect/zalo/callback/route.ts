import { NextResponse } from "next/server";
import { baseUrl, boot, store, zaloAdapter } from "@/server";
import { consumeOAuth, setChannelExternalId } from "@/core/connect";

// Zalo chuyển hướng về đây: ?code=...&oa_id=...&state=...
export async function GET(req: Request) {
  boot();
  const sp = new URL(req.url).searchParams;
  const back = (q: string) => NextResponse.redirect(`${baseUrl(req)}/?tab=set&${q}`);
  const code = sp.get("code"), oaId = sp.get("oa_id"), state = sp.get("state");
  if (!code || !oaId || !state) return back("error=" + encodeURIComponent("Zalo không trả đủ code, oa_id, state"));
  const st = await consumeOAuth(store, state, "zalo_oa");
  if (!st?.verifier) return back("error=" + encodeURIComponent("Phiên cấp quyền hết hạn hoặc không hợp lệ, hãy thử lại"));
  const z = zaloAdapter();
  if (!z) return back("error=" + encodeURIComponent("Chưa cấu hình Zalo"));
  const ok = await z.connect(st.channelId, code, st.verifier);
  if (!ok) return back("error=" + encodeURIComponent("Zalo từ chối mã cấp quyền"));
  await setChannelExternalId(store, st.channelId, oaId);
  return back("connected=" + encodeURIComponent(st.channelId));
}
