import { NextResponse } from "next/server";
import { adminOnly, boot, store } from "@/server";
import { moveTemplate } from "@/core/library";

export async function POST(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const { id, dir } = (await req.json().catch(() => ({}))) as { id?: string; dir?: number };
  if (!id || (dir !== -1 && dir !== 1)) return NextResponse.json({ ok: false }, { status: 400 });
  const ok = await moveTemplate(store, id, dir);
  return NextResponse.json({ ok });
}
