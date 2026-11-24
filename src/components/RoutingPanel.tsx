"use client";
/* Cài đặt chia khách theo kênh. Gọn: chọn chế độ, bảng người kèm tỷ lệ chia, một khối "Tùy chọn" thu gọn. Không có mặc định. */
import { useCallback, useEffect, useState } from "react";
import type { ChannelView } from "@/core/connect";
import type { RoutingMode } from "@/core/types";
import { useActor } from "./actor";

const KIND: Record<string, string> = { facebook: "Messenger", instagram: "Instagram", zalo_oa: "Zalo OA", zalo_personal: "Zalo cá nhân", web: "Web chat", tiktok: "TikTok" };
const COLOR: Record<string, string> = { facebook: "#1877F2", instagram: "#DB2777", zalo_oa: "#0068FF", zalo_personal: "#0EA5E9", web: "#0F766E", tiktok: "#111" };
const MODES: [RoutingMode, string, string][] = [
  ["manual", "Nhân viên tự nhận", "Khách mới ở trạng thái chưa nhận, nhân viên bấm Nhận khách."],
  ["round_robin", "Xoay vòng", "Lần lượt từng người, có thể đặt tỷ lệ chia."],
  ["least_busy", "Theo tải", "Giao cho người đang giữ ít hội thoại nhất (tính theo tỷ lệ)."],
  ["fixed", "Cố định một người", "Mọi khách của kênh giao cho một người."],
];
const DAYS: [number, string][] = [[1, "T2"], [2, "T3"], [3, "T4"], [4, "T5"], [5, "T6"], [6, "T7"], [7, "CN"]];

interface Form {
  mode: RoutingMode; fixed: string; pool: string[]; weights: Record<string, string>;
  preferOnline: boolean; sticky: boolean; maxOpen: string; escalate: string;
  useHours: boolean; days: number[]; start: string; end: string;
}
const fromCfg = (c: ChannelView): Form => {
  const r = c.routing;
  return {
    mode: r?.mode ?? "manual", fixed: r?.fixedUid ?? "", pool: r?.pool ?? [],
    weights: Object.fromEntries(Object.entries(r?.weights ?? {}).map(([k, v]) => [k, String(v)])),
    preferOnline: !!r?.preferOnline, sticky: !!r?.sticky, maxOpen: r?.maxOpen ? String(r.maxOpen) : "", escalate: r?.escalateMin ? String(r.escalateMin) : "",
    useHours: !!r?.hours, days: r?.hours?.days ?? [], start: r?.hours?.start ?? "", end: r?.hours?.end ?? "",
  };
};

async function api(url: string, method = "GET", body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  return r.json().catch(() => ({}));
}

function Card({ c, agents, onSaved }: { c: ChannelView; agents: { uid: string; name: string }[]; onSaved: () => void }) {
  const [f, setF] = useState<Form>(fromCfg(c));
  const [msg, setMsg] = useState<{ ok: boolean; s: string } | null>(null);
  const set = (p: Partial<Form>) => { setF({ ...f, ...p }); setMsg(null); };
  const people = agents.filter((a) => c.access[a.uid] === "send");
  const inPool = (uid: string) => f.pool.length === 0 || f.pool.includes(uid);

  async function save() {
    let routing: Record<string, unknown> | null = { mode: f.mode };
    if (f.mode === "manual") routing = c.routing ? { mode: "manual" } : null;
    else if (f.mode === "fixed") routing = { mode: "fixed", fixedUid: f.fixed };
    else {
      routing = { mode: f.mode };
      if (f.pool.length && f.pool.length < people.length) routing.pool = f.pool;
      const w = Object.entries(f.weights).filter(([u, v]) => v.trim() !== "" && Number(v) !== 1 && people.some((p) => p.uid === u));
      if (w.length) routing.weights = Object.fromEntries(w.map(([k, v]) => [k, Number(v)]));
      if (f.preferOnline) routing.preferOnline = true;
      if (f.sticky) routing.sticky = true;
      if (f.maxOpen.trim() !== "") routing.maxOpen = Number(f.maxOpen);
      if (f.escalate.trim() !== "") routing.escalateMin = Number(f.escalate);
      if (f.useHours) routing.hours = { days: f.days, start: f.start, end: f.end };
    }
    const r = await api(`/api/channels/${c.id}/routing`, "PUT", { routing });
    setMsg(r.ok ? { ok: true, s: "Đã lưu." } : { ok: false, s: r.error ?? "Lỗi" });
    if (r.ok) onSaved();
  }
  async function redo() {
    const r = await api(`/api/channels/${c.id}/routing`, "POST");
    setMsg(r.ok ? { ok: true, s: r.assigned ? `Đã chia ${r.assigned} hội thoại${r.left ? `, còn ${r.left} chưa chia được` : ""}.` : r.left ? `Chưa chia được ${r.left} hội thoại (không có người đủ điều kiện lúc này).` : "Không có hội thoại nào chờ chia." } : { ok: false, s: r.error ?? "Lỗi" });
    onSaved();
  }

  const status = (uid: string) => { const p = c.people[uid]; return !p ? "" : p.away ? "Tạm nghỉ" : p.online ? "Trực tuyến" : "Ngoại tuyến"; };
  const dot = (uid: string) => { const p = c.people[uid]; return p?.away ? "#D97706" : p?.online ? "#16A34A" : "#9CA3AF"; };
  const modeOn = c.routing?.mode ?? "manual";

  return (
    <div className="kcp-card">
      <header>
        <span className="kcp-pf" style={{ background: COLOR[c.kind] ?? "#64748B" }}>{(KIND[c.kind] ?? "?")[0]}</span>
        <div className="kcp-t"><b>{c.name}</b><small>{KIND[c.kind]} · {MODES.find(([m]) => m === modeOn)?.[1]}{modeOn !== "manual" && c.routing?.mode !== "fixed" ? ` · ${(c.routing?.pool?.length || people.length)} người` : ""} · {c.unassigned} chưa nhận</small></div>
      </header>
      <div className="kc-mt" role="tablist" aria-label="Chế độ chia khách" style={{ alignSelf: "flex-start", flexWrap: "wrap" }}>
        {MODES.map(([m, t, d]) => <button key={m} role="tab" aria-selected={f.mode === m} className={f.mode === m ? "on" : ""} title={d} onClick={() => set({ mode: m })}>{t}</button>)}
      </div>
      <div className="kv">{MODES.find(([m]) => m === f.mode)?.[2]}</div>

      {f.mode !== "manual" && (
        people.length === 0 ? <div className="kcp-note">Chưa có nhân viên nào có mức Nhắn tin ở kênh này. Thêm ở mục Phân quyền trước.</div> : (
          <div className="tw" style={{ border: "1px solid var(--line)", borderRadius: 10 }}>
            <table style={{ minWidth: 0, width: "100%" }}>
              <thead><tr><th style={{ width: 34 }} />{<th>Nhân viên</th>}<th>Trạng thái</th><th className="r">Đang giữ</th>{f.mode !== "fixed" && <th className="r" title="Người có số lớn hơn được chia nhiều hơn">Tỷ lệ chia</th>}</tr></thead>
              <tbody>
                {people.map((a) => (
                  <tr key={a.uid}>
                    <td>{f.mode === "fixed"
                      ? <input type="radio" name={`fx-${c.id}`} aria-label={`Giao cố định cho ${a.name}`} checked={f.fixed === a.uid} onChange={() => set({ fixed: a.uid })} />
                      : <input type="checkbox" aria-label={`Chia cho ${a.name}`} checked={inPool(a.uid)} onChange={() => { const cur = f.pool.length ? f.pool : people.map((p) => p.uid); set({ pool: cur.includes(a.uid) ? cur.filter((x) => x !== a.uid) : [...cur, a.uid] }); }} />}</td>
                    <td><b>{a.name}</b></td>
                    <td><span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><i style={{ width: 8, height: 8, borderRadius: "50%", background: dot(a.uid), display: "inline-block" }} />{status(a.uid)}</span></td>
                    <td className="r">{c.people[a.uid]?.open ?? 0}</td>
                    {f.mode !== "fixed" && <td className="r"><input type="number" min={1} max={10} disabled={!inPool(a.uid)} value={f.weights[a.uid] ?? ""} placeholder="1" onChange={(e) => set({ weights: { ...f.weights, [a.uid]: e.target.value } })} style={{ width: 64, textAlign: "right" }} /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {f.mode !== "manual" && f.mode !== "fixed" && (
        <details>
          <summary style={{ cursor: "pointer", color: "var(--navy)", fontWeight: 600, fontSize: 13 }}>Tùy chọn</summary>
          <div className="kc-fg" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", marginTop: 8 }}>
            <label className="kc-sw2"><input type="checkbox" checked={f.preferOnline} onChange={(e) => set({ preferOnline: e.target.checked })} /> Ưu tiên người đang trực tuyến <span className="kv">(không ai trực tuyến thì chia đều)</span></label>
            <label className="kc-sw2"><input type="checkbox" checked={f.sticky} onChange={(e) => set({ sticky: e.target.checked })} /> Khách quay lại giao về người cũ</label>
            <label className="kc-fl">Mỗi người giữ tối đa (hội thoại đang mở)
              <input type="number" min={1} max={500} value={f.maxOpen} placeholder="Để trống = không giới hạn" onChange={(e) => set({ maxOpen: e.target.value })} />
            </label>
            <label className="kc-fl">Chuyển người khác nếu chưa trả lời sau (phút)
              <input type="number" min={1} max={1440} value={f.escalate} placeholder="Để trống = không chuyển" onChange={(e) => set({ escalate: e.target.value })} />
            </label>
            <div className="kc-fl" style={{ gridColumn: "1 / -1" }}>
              <label className="kc-sw2"><input type="checkbox" checked={f.useHours} onChange={(e) => set({ useHours: e.target.checked })} /> Chỉ chia trong giờ làm việc (giờ Việt Nam; ngoài giờ để chưa nhận)</label>
              {f.useHours && (
                <div className="kc-lgl" style={{ marginTop: 4 }}>
                  {DAYS.map(([d, t]) => <button key={d} type="button" className="kc-mini" style={f.days.includes(d) ? { background: "var(--navy)", color: "#fff" } : { opacity: .6 }} onClick={() => set({ days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d] })}>{t}</button>)}
                  <input type="time" aria-label="Giờ bắt đầu" value={f.start} onChange={(e) => set({ start: e.target.value })} style={{ width: 110 }} />
                  <span className="kv">đến</span>
                  <input type="time" aria-label="Giờ kết thúc" value={f.end} onChange={(e) => set({ end: e.target.value })} style={{ width: 110 }} />
                </div>
              )}
            </div>
          </div>
        </details>
      )}

      <div className="kcp-foot">
        <button className="btn cta" onClick={save}>Lưu</button>
        {modeOn !== "manual" && <button className="btn" onClick={redo} disabled={c.unassigned === 0} title="Chia các hội thoại đang chờ nhận theo cấu hình đã lưu">Chia lại {c.unassigned} hội thoại chưa nhận</button>}
        {msg && <span className="kcp-msg" style={{ color: msg.ok ? "var(--ok)" : "var(--bad)" }}>{msg.s}</span>}
      </div>
    </div>
  );
}

export default function RoutingPanel() {
  const { staff } = useActor();
  const agents = staff.filter((s) => s.role === "agent");
  const [rows, setRows] = useState<ChannelView[]>([]);
  const load = useCallback(async () => setRows(((await api("/api/channels")).channels ?? []).filter((c: ChannelView) => !c.off)), []);
  useEffect(() => { load(); const t = setInterval(() => { if (!document.hidden) load(); }, 15000); return () => clearInterval(t); }, [load]);
  return (
    <div className="kcp">
      <p className="kcp-lead">Chọn cách chia khách mới cho <b>từng kênh</b>. Chỉ chia cho người có mức <b>Nhắn tin</b> ở kênh (mục Phân quyền), không chia cho người đang tạm nghỉ. Không chọn gì thì nhân viên tự bấm Nhận khách.</p>
      {rows.length === 0 && <div className="kv">Chưa có kênh nào.</div>}
      <div className="kcp-list">{rows.map((c) => <Card key={c.id + JSON.stringify(c.routing ?? null) + JSON.stringify(c.access)} c={c} agents={agents} onSaved={load} />)}</div>
    </div>
  );
}
