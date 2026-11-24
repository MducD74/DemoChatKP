"use client";
/* Cài đặt SLA theo kênh và theo từng sale. Không có giá trị mặc định: ô để trống cho đến khi quản trị nhập; kênh chưa cài thì không đo và không cảnh báo. */
import { useCallback, useEffect, useState } from "react";
import type { ChannelView } from "@/core/connect";
import type { SlaCfg } from "@/core/types";
import { useActor } from "./actor";

const KIND: Record<string, string> = { facebook: "Messenger", instagram: "Instagram", zalo_oa: "Zalo OA", zalo_personal: "Zalo cá nhân", web: "Web chat", tiktok: "TikTok" };
const COLOR: Record<string, string> = { facebook: "#1877F2", instagram: "#DB2777", zalo_oa: "#0068FF", zalo_personal: "#0EA5E9", web: "#0F766E", tiktok: "#111" };
const DAYS: [number, string][] = [[1, "T2"], [2, "T3"], [3, "T4"], [4, "T5"], [5, "T6"], [6, "T7"], [7, "CN"]];

interface Form { on: boolean; first: string; missed: string; useHours: boolean; days: number[]; start: string; end: string; perUser: Record<string, string> }
const empty = (): Form => ({ on: false, first: "", missed: "", useHours: false, days: [], start: "", end: "", perUser: {} });
const fromCfg = (s?: SlaCfg): Form => !s ? empty() : ({
  on: true, first: String(s.firstResponseMin), missed: s.missedMin ? String(s.missedMin) : "", useHours: !!s.hours,
  days: s.hours?.days ?? [], start: s.hours?.start ?? "", end: s.hours?.end ?? "",
  perUser: Object.fromEntries(Object.entries(s.perUser ?? {}).map(([k, v]) => [k, String(v)])),
});

async function api(url: string, method = "GET", body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  return r.json().catch(() => ({}));
}

function Card({ c, agents, onSaved }: { c: ChannelView; agents: { uid: string; name: string }[]; onSaved: () => void }) {
  const [f, setF] = useState<Form>(fromCfg(c.sla));
  const [msg, setMsg] = useState<{ ok: boolean; s: string } | null>(null);
  const set = (p: Partial<Form>) => { setF({ ...f, ...p }); setMsg(null); };
  const people = agents.filter((a) => c.access[a.uid] === "send");

  async function save() {
    if (!f.on) {
      const r = await api(`/api/channels/${c.id}/sla`, "PUT", { sla: null });
      setMsg(r.ok ? { ok: true, s: "Đã gỡ SLA, kênh này không còn đo." } : { ok: false, s: r.error ?? "Lỗi" });
      if (r.ok) onSaved();
      return;
    }
    const sla: Record<string, unknown> = { firstResponseMin: f.first.trim() === "" ? NaN : Number(f.first) };
    if (f.missed.trim() !== "") sla.missedMin = Number(f.missed);
    if (f.useHours) sla.hours = { days: f.days, start: f.start, end: f.end };
    const per = Object.entries(f.perUser).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, Number(v)]);
    if (per.length) sla.perUser = Object.fromEntries(per);
    const r = await api(`/api/channels/${c.id}/sla`, "PUT", { sla });
    setMsg(r.ok ? { ok: true, s: "Đã lưu SLA." } : { ok: false, s: r.error ?? "Lỗi" });
    if (r.ok) onSaved();
  }

  return (
    <div className="kcp-card">
      <header>
        <span className="kcp-pf" style={{ background: COLOR[c.kind] ?? "#64748B" }}>{(KIND[c.kind] ?? "?")[0]}</span>
        <div className="kcp-t"><b>{c.name}</b><small>{KIND[c.kind]} · {c.sla ? `đang đo, ngưỡng ${c.sla.firstResponseMin} phút` : "chưa cài SLA"}</small></div>
        <label className="kc-sw2"><input type="checkbox" checked={f.on} onChange={(e) => set({ on: e.target.checked })} /> Đo SLA cho kênh này</label>
      </header>
      {!f.on && <div className="kcp-note">Chưa cài SLA: kênh này không được đo và không có cảnh báo. Bật lên rồi nhập ngưỡng. Hệ thống không tự đặt giá trị nào.</div>}
      {f.on && (
        <div className="kc-fg" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
          <label className="kc-fl">Ngưỡng phản hồi (phút), bắt buộc
            <input type="number" min={1} max={1440} value={f.first} placeholder="Nhập số phút" onChange={(e) => set({ first: e.target.value })} />
          </label>
          <label className="kc-fl">Ngưỡng bỏ lỡ (phút), không bắt buộc
            <input type="number" min={1} max={10080} value={f.missed} placeholder="Để trống thì không đếm bỏ lỡ" onChange={(e) => set({ missed: e.target.value })} />
          </label>
        </div>
      )}
      {f.on && (
        <div className="kc-fl">
          <label className="kc-sw2"><input type="checkbox" checked={f.useHours} onChange={(e) => set({ useHours: e.target.checked })} /> Chỉ tính trong giờ làm việc (giờ Việt Nam)</label>
          {f.useHours && (
            <div className="kc-lgl" style={{ marginTop: 4 }}>
              {DAYS.map(([d, t]) => <button key={d} type="button" className={`kc-mini ${f.days.includes(d) ? "" : "kc-dim"}`} style={f.days.includes(d) ? { background: "var(--navy)", color: "#fff" } : undefined} onClick={() => set({ days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d] })}>{t}</button>)}
              <input type="time" aria-label="Giờ bắt đầu" value={f.start} onChange={(e) => set({ start: e.target.value })} style={{ width: 110 }} />
              <span className="kv">đến</span>
              <input type="time" aria-label="Giờ kết thúc" value={f.end} onChange={(e) => set({ end: e.target.value })} style={{ width: 110 }} />
            </div>
          )}
          <span className="kv">Không chọn thì tính cả thời gian thực (24 giờ, kể cả cuối tuần).</span>
        </div>
      )}
      {f.on && (
        <div className="kc-fl">
          Ngưỡng riêng từng sale <span className="kv" style={{ fontWeight: 400 }}>(để trống thì dùng ngưỡng của kênh; chỉ liệt kê người có mức Nhắn tin ở kênh này)</span>
          {people.length === 0 && <span className="kv">Chưa có nhân viên nào được vào kênh này ở mục Phân quyền.</span>}
          <div className="kcp-rows">
            {people.map((a) => (
              <div key={a.uid} className="kc-qrow2"><span style={{ minWidth: 70 }}>{a.name}</span>
                <input type="number" min={1} max={1440} value={f.perUser[a.uid] ?? ""} placeholder="phút" onChange={(e) => set({ perUser: { ...f.perUser, [a.uid]: e.target.value } })} style={{ width: 90 }} />
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="kcp-foot">
        <button className="btn cta" onClick={save}>{f.on ? "Lưu SLA" : c.sla ? "Gỡ SLA" : "Không đo"}</button>
        {msg && <span className="kcp-msg" style={{ color: msg.ok ? "var(--ok)" : "var(--bad)" }}>{msg.s}</span>}
      </div>
    </div>
  );
}

export default function SlaPanel() {
  const { staff } = useActor();
  const agents = staff.filter((s) => s.role === "agent");
  const [rows, setRows] = useState<ChannelView[]>([]);
  const load = useCallback(async () => setRows(((await api("/api/channels")).channels ?? []).filter((c: ChannelView) => !c.off)), []);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="kcp">
      <p className="kcp-lead">SLA là thời gian tối đa để trả lời khách. <b>Mỗi kênh tự đặt riêng</b>, kể cả ngưỡng riêng cho từng sale. Khi khách chờ gần đến ngưỡng, hệ thống báo &quot;sắp vượt&quot; ở Hội thoại và Tổng quan; quá ngưỡng thì báo &quot;vượt SLA&quot; và tính vào thống kê.</p>
      {rows.length === 0 && <div className="kv">Chưa có kênh nào.</div>}
      <div className="kcp-list">{rows.map((c) => <Card key={c.id + JSON.stringify(c.sla ?? null) + JSON.stringify(c.access)} c={c} agents={agents} onSaved={load} />)}</div>
    </div>
  );
}
