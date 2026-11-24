import { NextResponse } from "next/server";
import { boot, store, adminOnly } from "@/server";
import { NextResponse as NR } from "next/server";
import { beginOAuth, tiktokAuthUrl } from "@/core/connect";

export async function GET(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NR) return a;
  const portal = process.env.TIKTOK_AUTH_URL;
  if (!portal) return NextResponse.json({ ok: false, error: "Chưa đặt TIKTOK_AUTH_URL (link cấp quyền lấy ở My Apps > App Detail)" }, { status: 400 });
  const channelId = new URL(req.url).searchParams.get("channel") ?? "";
  const s = await beginOAuth(store, channelId, "tiktok", false);
  if (!s) return NextResponse.json({ ok: false, error: "Không thấy kênh" }, { status: 404 });
  return NextResponse.json({ ok: true, url: tiktokAuthUrl(portal, s.state) });
}
