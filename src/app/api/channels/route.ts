import { NextResponse } from "next/server";
import { adminOnly, baseUrl, boot, store } from "@/server";
import { NextResponse as NR } from "next/server";
import { setChannelName, setChannelSend } from "@/core/service";
import { channelViews, connectConfig, createChannel } from "@/core/connect";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NR) return a;
  return NextResponse.json({ channels: await channelViews(store), config: connectConfig(baseUrl(req)) });
}

export async function POST(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NR) return a;
  const b = await req.json().catch(() => ({}));
  const r = await createChannel(store, b);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}

export async function PATCH(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NR) return a;
  const { id, sendEnabled, name } = (await req.json().catch(() => ({}))) as { id?: string; sendEnabled?: boolean; name?: string };
  if (!id || (typeof sendEnabled !== "boolean" && typeof name !== "string")) return NextResponse.json({ error: "thiếu dữ liệu" }, { status: 400 });
  // PATCH { id, name }: đổi tên. PATCH { id, sendEnabled }: bật hoặc tắt gửi tin.
  const r = typeof name === "string" ? await setChannelName(store, id, name) : await setChannelSend(store, id, sendEnabled as boolean);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
