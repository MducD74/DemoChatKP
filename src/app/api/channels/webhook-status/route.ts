import { NextResponse } from "next/server";
import { adminOnly, boot } from "@/server";
import { probeWebhook, webhookSeen } from "@/core/webhookstate";

export const dynamic = "force-dynamic";

// Địa chỉ webhook công khai còn truy cập được không, và lần cuối nhận tin qua webhook (từ lúc máy chủ bật).
export async function GET(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const probe = await probeWebhook({ KPCHAT_PUBLIC_URL: process.env.KPCHAT_PUBLIC_URL, META_VERIFY_TOKEN: process.env.META_VERIFY_TOKEN });
  return NextResponse.json({ ...probe, seen: webhookSeen() });
}
