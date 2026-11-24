import { NextResponse } from "next/server";
import { adminOnly, boot, store } from "@/server";
import { deleteTemplate, listTemplates, saveTemplate } from "@/core/library";

export const dynamic = "force-dynamic";

export async function GET() {
  boot();
  return NextResponse.json({ templates: await listTemplates(store) });
}
export async function POST(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const r = await saveTemplate(store, await req.json().catch(() => ({})));
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
export async function DELETE(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const ok = await deleteTemplate(store, new URL(req.url).searchParams.get("id") ?? "");
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
