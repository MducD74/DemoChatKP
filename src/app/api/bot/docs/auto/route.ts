import { NextResponse } from "next/server";
import { adminOnly, boot, store } from "@/server";
import { setDocAuto } from "@/core/botsource";

export const dynamic = "force-dynamic";

// Bật hoặc tắt tự làm mới của một tài liệu từ link (web, Drive). POST { id, auto: boolean }
export async function POST(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const { id, auto } = (await req.json().catch(() => ({}))) as { id?: string; auto?: unknown };
  const r = await setDocAuto(store, String(id ?? ""), auto === true);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
