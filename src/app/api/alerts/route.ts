import { NextResponse } from "next/server";
import { adminOnly, boot, store } from "@/server";
import { collectAlerts } from "@/core/alerts";

export const dynamic = "force-dynamic";

// Cảnh báo vận hành cho quản trị: token kênh, đăng ký nhận tin, webhook. ?fresh=1 kiểm lại ngay (bỏ qua lưu đệm).
export async function GET(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  return NextResponse.json({ alerts: await collectAlerts(store, process.env, { force: fresh }) });
}
