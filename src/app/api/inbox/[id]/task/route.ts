import { NextResponse } from "next/server";
import { actorOf, boot, store } from "@/server";
import { changeTask } from "@/core/service";

type Ctx = { params: Promise<{ id: string }> };
const run = async (req: Request, ctx: Ctx, op: (b: Record<string, unknown>) => Parameters<typeof changeTask>[2]) => {
  boot();
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await changeTask(store, decodeURIComponent((await ctx.params).id), op(b), actorOf(req));
  return NextResponse.json(r, { status: r.ok ? 200 : r.code ?? 403 });
};

// Việc cần làm của hội thoại. POST { text, due? } thêm; PATCH { taskId, done } đánh dấu; DELETE { taskId } xóa
export const POST = (req: Request, ctx: Ctx) => run(req, ctx, (b) => ({ add: { text: b.text, due: b.due, time: b.time, priority: b.priority, owner: b.owner, note: b.note } }));
export const PATCH = (req: Request, ctx: Ctx) => run(req, ctx, (b) => ({ done: { taskId: String(b.taskId ?? ""), value: !!b.done } }));
export const DELETE = (req: Request, ctx: Ctx) => run(req, ctx, (b) => ({ remove: String(b.taskId ?? "") }));
