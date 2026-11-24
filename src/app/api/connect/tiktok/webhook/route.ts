import { NextResponse } from "next/server";
import { baseUrl, boot, adminOnly } from "@/server";
import { NextResponse as NR } from "next/server";
import { subscribeTikTokWebhook } from "@/core/connect";

// Đăng ký webhook cấp ứng dụng với TikTok (làm một lần sau khi có địa chỉ công khai HTTPS).
export async function POST(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NR) return a;
  const clientKey = process.env.TIKTOK_CLIENT_KEY, clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) return NextResponse.json({ ok: false, error: "Chưa cấu hình TikTok" }, { status: 400 });
  const base = baseUrl(req);
  if (!base.startsWith("https://")) return NextResponse.json({ ok: false, error: "Cần địa chỉ công khai HTTPS (đặt KPCHAT_PUBLIC_URL)" }, { status: 400 });
  const r = await subscribeTikTokWebhook({ clientKey, clientSecret, callbackUrl: `${base}/api/webhook/tiktok` });
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
