import { NextResponse } from "next/server";
import { adminOnly, boot, store } from "@/server";
import { setChannelSla } from "@/core/service";
import { DEMO_STAFF } from "@/core/staff";

// PUT { sla: {...} } để cài, PUT { sla: null } để gỡ SLA của kênh
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const body = (await req.json().catch(() => ({}))) as { sla?: unknown };
  if (!("sla" in body)) return NextResponse.json({ ok: false, error: "Thiếu dữ liệu" }, { status: 400 });
  const r = await setChannelSla(store, (await ctx.params).id, body.sla ?? null, DEMO_STAFF.filter((s) => s.role === "agent").map((s) => s.uid));
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
