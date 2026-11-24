import { NextResponse } from "next/server";
import { adminOnly, boot, store } from "@/server";
import { deleteBot, saveBot } from "@/core/chatbot";

export const dynamic = "force-dynamic";

// POST: tạo chatbot (không có id) hoặc sửa (có id). DELETE { id }: xóa.
export async function POST(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const r = await saveBot(store, await req.json().catch(() => ({})));
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}

export async function DELETE(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  const r = await deleteBot(store, String(id ?? ""));
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
