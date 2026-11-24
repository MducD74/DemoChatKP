import { readUpload } from "@/core/media";

// Công khai: Messenger, Zalo, TikTok tải ảnh từ địa chỉ này. Tên tệp là mã ngẫu nhiên 128 bit.
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const f = await readUpload((await ctx.params).id);
  if (!f) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(f.bytes), { headers: { "content-type": f.mime, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" } });
}
