import { NextResponse } from "next/server";
import { baseUrl, boot, store, adminOnly } from "@/server";
import { NextResponse as NR } from "next/server";
import { beginOAuth, zaloAuthUrl } from "@/core/connect";

export async function GET(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NR) return a;
  const appId = process.env.ZALO_APP_ID;
  if (!appId) return NextResponse.json({ ok: false, error: "Chưa đặt ZALO_APP_ID" }, { status: 400 });
  const channelId = new URL(req.url).searchParams.get("channel") ?? "";
  const s = await beginOAuth(store, channelId, "zalo_oa", true);
  if (!s?.challenge) return NextResponse.json({ ok: false, error: "Không thấy kênh" }, { status: 404 });
  return NextResponse.json({ ok: true, url: zaloAuthUrl(appId, `${baseUrl(req)}/api/connect/zalo/callback`, s.challenge, s.state) });
}
