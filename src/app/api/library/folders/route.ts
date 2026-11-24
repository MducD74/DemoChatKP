import { NextResponse } from "next/server";
import { adminOnly, boot, store } from "@/server";
import { createFolder, deleteFolder, renameFolder } from "@/core/library";

export async function POST(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const { name } = (await req.json().catch(() => ({}))) as { name?: string };
  const r = await createFolder(store, name ?? "");
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
export async function PATCH(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const { from, to } = (await req.json().catch(() => ({}))) as { from?: string; to?: string };
  const r = await renameFolder(store, from ?? "", to ?? "");
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
export async function DELETE(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const r = await deleteFolder(store, new URL(req.url).searchParams.get("name") ?? "");
  return NextResponse.json(r, { status: r.ok ? 200 : 404 });
}
