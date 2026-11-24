import { NextResponse } from "next/server";
import { adminOnly, baseUrl, boot, store } from "@/server";
import { listLibrary, uploadToLibrary } from "@/core/library";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  boot();
  return NextResponse.json(await listLibrary(store, baseUrl(req)));
}

// Tải ảnh lên thư viện (quản trị): nhiều tệp một lần, kèm thư mục (không bắt buộc)
export async function POST(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const form = await req.formData().catch(() => null);
  const files = (form?.getAll("file") ?? []).filter((f): f is File => f instanceof File);
  if (!files.length) return NextResponse.json({ ok: false, error: "Thiếu tệp" }, { status: 400 });
  const folder = String(form?.get("folder") ?? "") || undefined;
  const done: string[] = [], errors: string[] = [];
  for (const f of files) {
    const r = await uploadToLibrary(store, { bytes: new Uint8Array(await f.arrayBuffer()), mime: f.type, name: f.name, folder });
    if (r.ok) done.push(r.item.id); else errors.push(`${f.name}: ${r.error}`);
  }
  return NextResponse.json({ ok: errors.length === 0, done, error: errors.join("; ") || undefined }, { status: errors.length && !done.length ? 400 : 200 });
}
