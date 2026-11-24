import { NextResponse } from "next/server";
import { adminOnly, boot, store } from "@/server";
import { saveAnthropicKey, syncBotKey, validKeyShape } from "@/core/chatbot";
import { keySource, verifyKey } from "@/core/botmodel";

export const dynamic = "force-dynamic";

// Khóa API Anthropic (quản trị). Không bao giờ trả khóa về: chỉ cho biết nguồn và 4 ký tự cuối.
async function status() {
  const { last4 } = syncBotKey(await store.load());
  return { source: keySource(), last4 };
}

export async function GET(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  return NextResponse.json(await status());
}

// PUT { key }: kiểm với Anthropic rồi lưu mã hóa
export async function PUT(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const { key } = (await req.json().catch(() => ({}))) as { key?: string };
  const k = String(key ?? "").trim();
  if (!validKeyShape(k)) return NextResponse.json({ ok: false, error: "Khóa Anthropic có dạng sk-ant-... (không có khoảng trắng)" }, { status: 400 });
  const v = await verifyKey(k);
  if (!v.ok && (v.status === 401 || v.status === 403)) return NextResponse.json({ ok: false, error: v.error }, { status: 400 });
  const r = await saveAnthropicKey(store, k);
  return NextResponse.json(r.ok ? { ok: true, checked: v.ok, ...(v.ok ? {} : { warning: v.error }), ...(await status()) } : r, { status: r.ok ? 200 : 400 });
}

// DELETE: xóa khóa đã lưu (còn biến môi trường ANTHROPIC_API_KEY thì dùng tiếp biến đó)
export async function DELETE(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  await saveAnthropicKey(store, null);
  return NextResponse.json({ ok: true, ...(await status()) });
}
