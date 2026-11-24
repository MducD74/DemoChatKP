"use client";
/* Mục Đánh giá của tab Chatbot (quản trị): bộ câu mẫu, chạy thử qua chatbot, chấm theo tiêu chí "sale giỏi", so trước và sau.
   Chạy thử chỉ soạn câu trả lời cho câu hỏi giả, không gửi tin cho ai. */
import { useCallback, useEffect, useRef, useState } from "react";
import { Ic, Modal } from "./ui";
import "./pages/botevals.css";

interface Item { id?: string; group: string; question: string; expected?: string; expect: "answer" | "handoff" }
interface SetT { id: string; name: string; botId: string; items: Item[]; at: number }
interface Summary { done: number; total: number; pass: number; passRate: number; handoffOk: number; handoffWrong: number; errors: number; avgPercent: number | null; byGroup: { group: string; total: number; pass: number }[] }
interface RunSum { id: string; setId: string; setName: string; botId: string; botName: string; model: string; at: number; judge: boolean; status: "running" | "done" | "error"; total: number; error?: string; usage: { input: number; output: number }; summary: Summary }
interface Result { itemId: string; group: string; question: string; expected?: string; expect: "answer" | "handoff"; reply?: string; handoff?: string; error?: string; ok?: boolean; scores?: Record<string, number | null>; percent?: number; why?: string; manual?: "pass" | "fail" }
interface RunFull { id: string; setName: string; botName: string; model: string; at: number; judge: boolean; status: string; total: number; results: Result[]; error?: string }
interface Data { sets: SetT[]; runs: RunSum[]; groups: string[]; criteria: [string, string][]; passPercent: number; ready: boolean }

async function api(url: string, method = "GET", body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  return r.json().catch(() => ({}));
}
const when = (t: number) => new Date(t).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const effPass = (r: Result, pp: number) => (r.manual ? r.manual === "pass" : !r.error && r.ok === true && (!r.scores || (r.scores.dung_thong_tin !== 0 && (r.percent ?? 0) >= pp)));

interface SetForm { id?: string; name: string; botId: string; seed: boolean; items: Item[]; err: string; busy: boolean }

// botId: chỉ hiện và tạo bộ câu của chatbot này (trang riêng của chatbot); bỏ trống thì hiện tất cả chatbot (tab chung).
export default function BotEvalPanel({ bots, botId }: { bots: { id: string; name: string }[]; botId?: string }) {
  const [d, setD] = useState<Data | null>(null);
  const [sf, setSf] = useState<SetForm | null>(null);
  const [view, setView] = useState<{ run: RunFull; summary: Summary } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; s: string } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => { const j = await api("/api/bot/evals"); if (j.ok) setD(j); }, []);
  useEffect(() => { void load(); }, [load]);
  // đang có lần chạy thì hỏi lại 2,5 giây một lần để xem tiến độ
  const running = !!d?.runs.some((r) => r.status === "running");
  useEffect(() => {
    if (!running) return;
    timer.current = setInterval(() => void load(), 2500);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [running, load]);

  if (!d) return <div className="kv">Đang tải...</div>;
  const botName = (id: string) => bots.find((b) => b.id === id)?.name ?? "(chatbot đã xóa)";
  const sets = botId ? d.sets.filter((s) => s.botId === botId) : d.sets;

  async function saveSet() {
    if (!sf) return;
    setSf({ ...sf, busy: true, err: "" });
    const r = await api("/api/bot/evals", "POST", { action: "save-set", id: sf.id, name: sf.name, botId: sf.botId, seed: sf.seed && !sf.id, items: sf.items });
    if (!r.ok) return setSf({ ...sf, busy: false, err: r.error ?? "Không lưu được" });
    setSf(null);
    await load();
  }
  async function delSet(s: SetT) {
    if (!confirm(`Xóa bộ câu "${s.name}" và các lần chạy của nó?`)) return;
    await api("/api/bot/evals", "POST", { action: "delete-set", id: s.id });
    await load();
  }
  async function run(s: SetT, judge: boolean) {
    setMsg(null);
    const r = await api("/api/bot/evals", "POST", { action: "run", setId: s.id, judge });
    setMsg(r.ok ? { ok: true, s: `Đang chạy ${s.items.length} câu${judge ? " và chấm bằng AI" : ""}. Kết quả hiện dần bên dưới.` } : { ok: false, s: r.error ?? "Không chạy được" });
    await load();
  }
  async function open(id: string) {
    const j = await api(`/api/bot/evals?run=${encodeURIComponent(id)}`);
    if (j.ok) setView({ run: j.run, summary: j.summary });
  }
  async function mark(r: Result, v: "pass" | "fail") {
    if (!view) return;
    const next = r.manual === v ? null : v;
    const j = await api("/api/bot/evals", "POST", { action: "mark", runId: view.run.id, itemId: r.itemId, manual: next });
    if (j.ok) { await open(view.run.id); await load(); }
  }
  const upd = (i: number, p: Partial<Item>) => sf && setSf({ ...sf, items: sf.items.map((x, k) => (k === i ? { ...x, ...p } : x)), err: "" });

  return (
    <div className="kcp">
      {botId
        ? <div className="bp-sh"><div><b>Đánh giá chatbot này</b><small>Cho chatbot trả lời thử bộ câu hỏi khách hay hỏi rồi chấm điểm. Chạy lại sau mỗi lần sửa tài liệu, kịch bản hay quy tắc. Không gửi tin cho ai, nhưng có gọi mô hình nên tốn tiền theo số câu (chấm bằng AI tốn gấp đôi). Đạt khi đúng ý, không bịa và từ {d.passPercent}% điểm; anh chấm tay Đạt hoặc Không đạt để thắng máy.</small></div></div>
        :       <div className="kcp-note">Cho chatbot trả lời thử một bộ câu hỏi khách hay hỏi rồi chấm theo 8 tiêu chí "sale giỏi". Chạy lại sau mỗi lần sửa tài liệu, kịch bản hay quy tắc để biết chatbot tốt lên hay tệ đi. Chạy thử <b>không gửi tin cho ai</b>, nhưng có gọi mô hình nên tốn tiền theo số câu (chấm bằng AI tốn gấp đôi). Đạt khi đúng ý (cần chuyển người thì chuyển), không bịa thông tin và đạt từ {d.passPercent}% điểm; anh có thể chấm tay Đạt hoặc Không đạt để thắng máy.</div>}
      {!d.ready && <div className="kcp-note">Chưa có khóa mô hình nên chưa chạy được. Nhập khóa ở Cài đặt &gt; Khóa AI.</div>}
      {msg && <span className="kcp-msg" style={{ color: msg.ok ? "var(--ok)" : "var(--bad)" }}>{msg.s}</span>}
      <div style={{ display: "flex" }}>
        <button className="btn cta" disabled={bots.length === 0} onClick={() => setSf({ name: "", botId: botId ?? bots[0]?.id ?? "", seed: true, items: [], err: "", busy: false })}><Ic n="plus" /> Thêm bộ câu</button>
      </div>
      {bots.length === 0 && <div className="kcp-note">Cần tạo chatbot trước, rồi mới thêm bộ câu cho chatbot đó.</div>}
      {sets.length === 0 && bots.length > 0 && <div className="kcp-note">{botId ? "Chatbot này chưa có bộ câu nào." : "Chưa có bộ câu nào."} Bấm <b>Thêm bộ câu</b>{botId ? "" : ", chọn chatbot"} và nạp 40 câu mẫu (8 nhóm), rồi điền đáp án đúng cho các câu quan trọng.</div>}
      <div className="kcp-list">
        {sets.map((s) => {
          const runs = d.runs.filter((r) => r.setId === s.id);
          const busy = runs.some((r) => r.status === "running");
          return (
            <div key={s.id} className="kce-set">
              <div className="kce-top">
                <div className="nm"><b>{s.name}</b><small>{botId ? "" : `Chatbot: ${botName(s.botId)} · `}{s.items.length} câu · {s.items.filter((i) => i.expected).length} câu có đáp án đúng</small></div>
                <div className="kce-ac">
                  <button className="btn" disabled={busy || !d.ready} title="Máy kiểm đúng ý, không bịa tự động; không gọi người chấm" onClick={() => run(s, false)}>Chạy thử</button>
                  <button className="btn cta" disabled={busy || !d.ready} title="Thêm một lượt mô hình chấm 7 tiêu chí cho mỗi câu" onClick={() => run(s, true)}>Chạy và chấm bằng AI</button>
                  <button className="btn" onClick={() => setSf({ id: s.id, name: s.name, botId: s.botId, seed: false, items: s.items.map((x) => ({ ...x })), err: "", busy: false })}>Sửa bộ câu</button>
                  <button className="btn kcb-del" aria-label={`Xóa bộ câu ${s.name}`} onClick={() => delSet(s)}><Ic n="trash" /></button>
                </div>
              </div>
              {runs.length === 0 && <div className="kv">Chưa chạy lần nào.</div>}
              <div className="kce-runs">
                {runs.slice(0, 6).map((r, i) => {
                  const prev = runs.slice(i + 1).find((x) => x.status === "done" && x.judge === r.judge); // so cùng cách chấm, không so máy kiểm với chấm AI
                  const delta = r.status === "done" && prev ? r.summary.pass - prev.summary.pass : null;
                  return (
                    <div key={r.id} className="kce-run">
                      <span className="t">{when(r.at)}</span>
                      {r.status === "running" && <span>Đang chạy {r.summary.done}/{r.total}...</span>}
                      {r.status === "error" && <span className="kce-no">{r.error ?? "Lỗi"} ({r.summary.done}/{r.total} câu)</span>}
                      {r.status === "done" && <><b>Đạt {r.summary.pass}/{r.summary.done} ({r.summary.passRate}%)</b>{r.summary.avgPercent !== null && <span>điểm TB {r.summary.avgPercent}%</span>}</>}
                      {delta !== null && delta !== 0 && <span className={`kce-d ${delta > 0 ? "up" : "dn"}`}>{delta > 0 ? "+" : ""}{delta} câu so với lần chạy trước cùng cách chấm</span>}
                      <span className="kce-bar"><i style={{ width: `${r.summary.passRate}%` }} /></span>
                      <span className="kv">{r.judge ? "có chấm AI" : "máy kiểm"} · {r.model}</span>
                      <button className="btn" onClick={() => open(r.id)}>Xem</button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {sf && (
        <Modal wide title={sf.id ? "Sửa bộ câu" : "Thêm bộ câu"} onClose={() => setSf(null)}
          footer={<><span className="kcb-err">{sf.err}</span><button className="btn" onClick={() => setSf(null)}>Hủy</button><button className="btn cta" disabled={sf.busy} onClick={saveSet}>{sf.busy ? "Đang lưu..." : "Lưu"}</button></>}>
          <div className="kcb">
            <section>
              <input className="kcb-in" maxLength={60} value={sf.name} placeholder="Tên bộ câu, ví dụ: XuXi - 40 câu mẫu" onChange={(e) => setSf({ ...sf, name: e.target.value, err: "" })} />
              {!sf.id && (
                <>
                  {!botId && <div className="kcb-f"><label>Chatbot được chấm</label>
                    <select className="kcb-in" value={sf.botId} onChange={(e) => setSf({ ...sf, botId: e.target.value })}>{bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                  </div>}
                  <label className="kc-sw2"><input type="checkbox" checked={sf.seed} onChange={(e) => setSf({ ...sf, seed: e.target.checked, items: e.target.checked ? [] : [{ group: d.groups[0], question: "", expect: "answer" }] })} /> Nạp sẵn 40 câu mẫu (8 nhóm), điền đáp án đúng sau</label>
                </>
              )}
              {(sf.id || !sf.seed) && (
                <div className="tw m rt">
                  <table className="kce-edit">
                    <thead><tr><th style={{ width: 150 }}>Nhóm</th><th>Câu hỏi của khách</th><th>Đáp án đúng (không bắt buộc)</th><th style={{ width: 120 }}>Chatbot nên</th><th style={{ width: 30 }} /></tr></thead>
                    <tbody>
                      {sf.items.map((it, i) => (
                        <tr key={i}>
                          <td><select value={it.group} onChange={(e) => upd(i, { group: e.target.value })}>{d.groups.map((g) => <option key={g} value={g}>{g}</option>)}</select></td>
                          <td><textarea rows={2} maxLength={300} value={it.question} onChange={(e) => upd(i, { question: e.target.value })} /></td>
                          <td><textarea rows={2} maxLength={500} value={it.expected ?? ""} onChange={(e) => upd(i, { expected: e.target.value })} /></td>
                          <td><select value={it.expect} onChange={(e) => upd(i, { expect: e.target.value as "answer" | "handoff" })}><option value="answer">Trả lời</option><option value="handoff">Chuyển người</option></select></td>
                          <td><button type="button" className="btn kcb-del" aria-label="Xóa câu" onClick={() => setSf({ ...sf, items: sf.items.filter((_, k) => k !== i) })}><Ic n="trash" /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {(sf.id || !sf.seed) && <button type="button" className="btn" style={{ alignSelf: "flex-start" }} disabled={sf.items.length >= 60} onClick={() => setSf({ ...sf, items: [...sf.items, { group: d.groups[0], question: "", expect: "answer" }] })}><Ic n="plus" /> Thêm câu ({sf.items.length}/60)</button>}
            </section>
          </div>
        </Modal>
      )}

      {view && (
        <Modal wide title={`Kết quả: ${view.run.setName} · ${when(view.run.at)}`} onClose={() => setView(null)} footer={<button className="btn" onClick={() => setView(null)}>Đóng</button>}>
          <div className="kcb">
            <section>
              <div className="kce-tiles">
                <div><span>Đạt</span><b>{view.summary.pass}/{view.summary.done}</b></div>
                <div><span>Tỷ lệ đạt</span><b>{view.summary.passRate}%</b></div>
                {view.summary.avgPercent !== null && <div><span>Điểm TB (AI)</span><b>{view.summary.avgPercent}%</b></div>}
                <div><span>Sai ý (chuyển hoặc trả lời sai lúc)</span><b>{view.summary.handoffWrong}</b></div>
                <div><span>Lỗi gọi mô hình</span><b>{view.summary.errors}</b></div>
              </div>
              {view.run.status === "running" && <div className="kv">Đang chạy, đóng rồi mở lại để xem thêm kết quả.</div>}
              <div className="kcb-f"><label>Theo nhóm</label>
                {view.summary.byGroup.map((g) => (
                  <div key={g.group} className="kce-grp"><span>{g.group}</span><span className="kce-bar"><i style={{ width: `${Math.round((g.pass / g.total) * 100)}%` }} /></span><b>{g.pass}/{g.total}</b></div>
                ))}
              </div>
              <div className="tw m rt">
                <table>
                  <thead><tr><th>Nhóm</th><th>Câu hỏi</th><th>Chatbot trả lời</th><th>Máy kiểm</th>{view.run.judge && <th>Điểm</th>}<th>Đạt?</th></tr></thead>
                  <tbody>
                    {view.run.results.map((r) => (
                      <tr key={r.itemId}>
                        <td className="kv">{r.group}</td>
                        <td style={{ maxWidth: 240 }}>{r.question}{r.expected && <div className="kv">Đáp án: {r.expected}</div>}</td>
                        <td><div className="kce-rep">{r.error ? <span className="kce-no">Lỗi: {r.error}</span> : r.handoff ? <i>Chuyển người: {r.handoff}</i> : r.reply}</div>{r.why && <div className="kv">{r.why}</div>}</td>
                        <td>{r.error ? "–" : r.ok ? <span className="kce-ok">Đúng ý</span> : <span className="kce-no">{r.expect === "handoff" ? "Lẽ ra phải chuyển người" : "Lẽ ra phải trả lời"}</span>}</td>
                        {view.run.judge && <td title={r.scores ? d.criteria.map(([k, l]) => `${l}: ${r.scores?.[k] ?? "không áp dụng"}`).join("\n") : ""}>{typeof r.percent === "number" ? `${r.percent}%` : "–"}</td>}
                        <td>
                          <div className={effPass(r, d.passPercent) ? "kce-ok" : "kce-no"}>{effPass(r, d.passPercent) ? "Đạt" : "Không"}{r.manual ? " (chấm tay)" : ""}</div>
                          <div className="kce-mk"><button className={r.manual === "pass" ? "on p" : ""} onClick={() => mark(r, "pass")}>Đạt</button><button className={r.manual === "fail" ? "on f" : ""} onClick={() => mark(r, "fail")}>Không</button></div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </Modal>
      )}
    </div>
  );
}
