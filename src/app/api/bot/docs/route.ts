import { NextResponse } from "next/server";
import { adminOnly, boot, store } from "@/server";
import { importDoc, type ImportInput } from "@/core/botsource";

export const dynamic = "force-dynamic";

// Thêm tài liệu kiến thức từ nguồn ngoài (quản trị). Tệp: multipart có trường "file". Link: JSON { kind: "web" | "drive", url, title? }.
export async function POST(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  let input: ImportInput;
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    const f = form?.get("file");
    if (!(f instanceof File)) return NextResponse.json({ ok: false, error: "Thiếu tệp" }, { status: 400 });
    let channelIds: string[] = [];
    try { channelIds = JSON.parse(String(form?.get("channelIds") ?? "[]")); } catch { /* bỏ qua */ }
    input = { kind: "file", title: String(form?.get("title") ?? ""), category: String(form?.get("category") ?? ""), channelIds, brandId: String(form?.get("brandId") ?? ""), file: { bytes: new Uint8Array(await f.arrayBuffer()), mime: f.type, name: f.name } };
  } else {
    const b = (await req.json().catch(() => ({}))) as { kind?: string; url?: string; title?: string; category?: string; channelIds?: string[]; brandId?: string };
    if (b.kind !== "web" && b.kind !== "drive") return NextResponse.json({ ok: false, error: "Loại nguồn không hợp lệ" }, { status: 400 });
    input = { kind: b.kind, url: b.url, title: b.title, category: b.category, channelIds: b.channelIds, brandId: b.brandId };
  }
  const r = await importDoc(store, input);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
