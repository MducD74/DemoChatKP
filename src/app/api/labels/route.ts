import { NextResponse } from "next/server";
import { actorOf, boot, store } from "@/server";
import { getLabelCfg, setLabelCfg } from "@/core/service";

export const dynamic = "force-dynamic";

// Danh mục nhãn: mọi nhân viên đọc được (để chọn nhãn), chỉ quản trị lưu.
export async function GET() {
  boot();
  return NextResponse.json({ ok: true, cfg: await getLabelCfg(store) });
}

export async function PUT(req: Request) {
  boot();
  const b = await req.json().catch(() => ({}));
  const r = await setLabelCfg(store, b, actorOf(req));
  return NextResponse.json(r, { status: r.ok ? 200 : r.code ?? 400 });
}
