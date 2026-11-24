import { NextResponse } from "next/server";
import { adminOnly, boot, store } from "@/server";
import { getAudit } from "@/core/audit";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  return NextResponse.json({ rows: await getAudit(store, a) });
}
