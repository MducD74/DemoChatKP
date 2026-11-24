import { NextResponse } from "next/server";
import { ZALO_PERSONAL_ENABLED, ZALO_PERSONAL_OFF } from "@/core/guardrails";
import { adminOnly, boot, store } from "@/server";
import { abortFlow, getFlow, startQrFlow } from "@/core/zalopersonal";

export const dynamic = "force-dynamic";

// Nối Zalo cá nhân bằng quét QR. POST { channelId? }: bắt đầu (channelId: quét lại cho kênh đã có). GET ?flow=: tình hình. DELETE ?flow=: hủy.
export async function POST(req: Request) {
  boot();
  if (!ZALO_PERSONAL_ENABLED) return NextResponse.json({ ok: false, error: ZALO_PERSONAL_OFF }, { status: 403 });
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const { channelId } = (await req.json().catch(() => ({}))) as { channelId?: string };
  const { id } = await startQrFlow(store, { expectChannelId: channelId });
  return NextResponse.json({ ok: true, flow: id });
}

export async function GET(req: Request) {
  boot();
  if (!ZALO_PERSONAL_ENABLED) return NextResponse.json({ ok: false, error: ZALO_PERSONAL_OFF }, { status: 403 });
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const f = getFlow(new URL(req.url).searchParams.get("flow") ?? "");
  return f ? NextResponse.json({ ok: true, flow: f }) : NextResponse.json({ ok: false, error: "Phiên quét đã hết hạn, hãy bắt đầu lại" }, { status: 404 });
}

export async function DELETE(req: Request) {
  boot();
  if (!ZALO_PERSONAL_ENABLED) return NextResponse.json({ ok: false, error: ZALO_PERSONAL_OFF }, { status: 403 });
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  return NextResponse.json({ ok: abortFlow(new URL(req.url).searchParams.get("flow") ?? "") });
}
