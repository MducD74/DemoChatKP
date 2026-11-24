import { NextResponse } from "next/server";
import { actorOf, baseUrl, boot, store } from "@/server";
import { sendReply } from "@/core/service";
import type { Attachment } from "@/core/types";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  boot();
  const b = (await req.json().catch(() => ({}))) as { text?: string; attachments?: Attachment[] };
  // Chỉ nhận ảnh đã tải lên chính KP Chat (tránh bắt máy chủ tải địa chỉ tùy ý).
  const prefix = `${baseUrl(req)}/api/media/`;
  const atts = (b.attachments ?? []).filter((a) => a?.type === "image" && typeof a.url === "string" && a.url.startsWith(prefix)).map((a) => ({ type: "image" as const, url: a.url, name: a.name }));
  if ((b.attachments?.length ?? 0) !== atts.length) return NextResponse.json({ ok: false, error: "Ảnh đính kèm không hợp lệ" }, { status: 400 });
  if (atts.length > 10) return NextResponse.json({ ok: false, error: "Tối đa 10 ảnh một lần gửi" }, { status: 400 });
  const r = await sendReply(store, decodeURIComponent((await ctx.params).id), { text: b.text, attachments: atts }, actorOf(req));
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
