import { NextResponse } from "next/server";
import { baseUrl } from "@/server";
import { saveUpload } from "@/core/media";

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "Thiếu tệp" }, { status: 400 });
  const r = await saveUpload(new Uint8Array(await file.arrayBuffer()), file.type);
  if (!r.ok) return NextResponse.json(r, { status: 400 });
  return NextResponse.json({ ok: true, url: `${baseUrl(req)}/api/media/${r.id}`, name: file.name });
}
