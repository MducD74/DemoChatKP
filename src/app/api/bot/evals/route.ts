import { NextResponse } from "next/server";
import { adminOnly, boot, store } from "@/server";
import { CRITERIA, EVAL_GROUPS, EVAL_LIMITS, PASS_PERCENT, deleteEvalSet, evalState, markEvalItem, runSummary, saveEvalSet, startEvalRun, viewRun } from "@/core/botevals";
import { providerStatus } from "@/core/botmodel";

export const dynamic = "force-dynamic";

// Thước đo chatbot (chỉ quản trị): bộ câu mẫu, chạy thử, kết quả từng lần. Chạy thử chỉ soạn câu trả lời cho câu hỏi giả, không gửi tin cho ai.
// GET: danh sách bộ câu và tóm tắt các lần chạy. GET ?run=<mã>: chi tiết một lần chạy.
// POST { action: "save-set" | "delete-set" | "run" | "mark", ... }
export async function GET(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const db = await store.load();
  const st = evalState(db);
  const runId = new URL(req.url).searchParams.get("run");
  if (runId) {
    const r = st.runs.find((x) => x.id === runId);
    if (!r) return NextResponse.json({ ok: false, error: "Không thấy lần chạy" }, { status: 404 });
    const run = viewRun(r);
    return NextResponse.json({ ok: true, run, summary: runSummary(run) });
  }
  const runs = [...st.runs].reverse().map((r) => { const v = viewRun(r); return { id: v.id, setId: v.setId, setName: v.setName, botId: v.botId, botName: v.botName, model: v.model, at: v.at, judge: v.judge, status: v.status, total: v.total, error: v.error, finishedAt: v.finishedAt, usage: v.usage, summary: runSummary(v) }; });
  return NextResponse.json({ ok: true, sets: st.sets, runs, groups: EVAL_GROUPS, criteria: CRITERIA, passPercent: PASS_PERCENT, limits: EVAL_LIMITS, ready: providerStatus().ready });
}

export async function POST(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  let r: { ok: boolean; error?: string } & Record<string, unknown>;
  if (b.action === "save-set") r = await saveEvalSet(store, b);
  else if (b.action === "delete-set") r = await deleteEvalSet(store, String(b.id ?? ""));
  else if (b.action === "mark") r = await markEvalItem(store, String(b.runId ?? ""), String(b.itemId ?? ""), b.manual ?? null);
  else if (b.action === "run") {
    const s = await startEvalRun(store, String(b.setId ?? ""), { judge: b.judge === true });
    r = s.ok ? { ok: true, runId: s.runId } : s; // chạy tiếp ở nền, giao diện hỏi lại để xem tiến độ
  } else r = { ok: false, error: "Việc không hợp lệ" };
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
