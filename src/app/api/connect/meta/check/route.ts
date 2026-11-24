import { NextResponse } from "next/server";
import { adminOnly, boot, store } from "@/server";
import { configureWebhook, runChecks, type MetaEnv } from "@/core/metacheck";

export const dynamic = "force-dynamic";
const env = (): MetaEnv => ({
  META_APP_ID: process.env.META_APP_ID, META_APP_SECRET: process.env.META_APP_SECRET, META_VERIFY_TOKEN: process.env.META_VERIFY_TOKEN, META_LOGIN_CONFIG_ID: process.env.META_LOGIN_CONFIG_ID,
  KPCHAT_PUBLIC_URL: process.env.KPCHAT_PUBLIC_URL, KPCHAT_ACCESS_KEY: process.env.KPCHAT_ACCESS_KEY, KPCHAT_SECRET_KEY: process.env.KPCHAT_SECRET_KEY,
});

// GET: chạy bộ kiểm tra (có gọi Meta và gọi thử địa chỉ công khai). POST: tự cấu hình webhook của ứng dụng.
export async function GET(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  return NextResponse.json({ checks: await runChecks(store, env()) });
}
export async function POST(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const r = await configureWebhook(env());
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
