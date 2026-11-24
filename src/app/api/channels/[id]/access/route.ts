import { NextResponse } from "next/server";
import { adminOnly, boot, store } from "@/server";
import { setChannelAccess } from "@/core/service";
import { DEMO_STAFF } from "@/core/staff";

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const { access } = (await req.json().catch(() => ({}))) as { access?: Record<string, "send" | "view"> };
  if (!access || typeof access !== "object") return NextResponse.json({ ok: false, error: "Thiếu dữ liệu" }, { status: 400 });
  const r = await setChannelAccess(store, (await ctx.params).id, access, DEMO_STAFF.filter((s) => s.role === "agent").map((s) => s.uid));
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
