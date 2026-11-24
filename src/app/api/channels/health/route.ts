import { NextResponse } from "next/server";
import { adminOnly, boot, store } from "@/server";
import { checkMetaHealth } from "@/core/metahealth";

export const dynamic = "force-dynamic";

// Tình trạng token và đăng ký nhận tin của các kênh Messenger và Instagram (gọi Meta, nên chỉ quản trị gọi).
export async function GET(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  return NextResponse.json({ health: await checkMetaHealth(store, { appId: process.env.META_APP_ID, appSecret: process.env.META_APP_SECRET }) });
}
