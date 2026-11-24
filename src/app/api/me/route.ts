import { NextResponse } from "next/server";
import { actorOf, boot, store } from "@/server";
import { DEMO_STAFF } from "@/core/staff";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  boot();
  const away = (await store.load()).away ?? {};
  return NextResponse.json({ me: actorOf(req), staff: DEMO_STAFF, away });
}
