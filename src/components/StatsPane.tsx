"use client";
/* Mục Thống kê: khuôn FilterBar, Collapse + strip stat, bảng tw (như trang Sản phẩm của KP Travel). Admin xem tất cả, nhân viên chỉ thấy số của mình. */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Statistics, SlaRow } from "@/core/stats";
import { Chip, Collapse, FilterBar, Select } from "./ui";
import { staffLabel, useActor } from "./actor";

const KIND: Record<string, string> = { facebook: "Messenger", instagram: "Instagram", zalo_oa: "Zalo OA", zalo_personal: "Zalo cá nhân", web: "Web chat", tiktok: "TikTok" };
const PERIODS: [string, string][] = [["today", "Hôm nay"], ["7d", "7 ngày qua"], ["30d", "30 ngày qua"], ["month", "Tháng này"]];

function periodRange(p: string, now = Date.now()): { from: number; to: number } {
  const startOfDay = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  if (p === "today") return { from: startOfDay(now), to: now };
  if (p === "30d") return { from: now - 30 * 86400_000, to: now };
  if (p === "month") { const d = new Date(now); return { from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), to: now }; }
  return { from: now - 7 * 86400_000, to: now };
}
export const fmtMin = (m: number | null | undefined) => {
  if (m == null) return "—";
  if (m < 1) return "dưới 1 phút";
  if (m < 60) return `${Math.round(m)} phút`;
  const h = Math.floor(m / 60), r = Math.round(m % 60);
  return r ? `${h} giờ ${r} phút` : `${h} giờ`;
};
const pct = (r: number | null) => (r == null ? "—" : `${Math.round(r * 100)}%`);

function SlaCells({ s }: { s: SlaRow }) {
  if (!s.configured) return <><td className="r kv" colSpan={4}>Chưa cài SLA</td></>;
  const bad = s.rate != null && s.rate < 0.8;
  return (
    <>
      <td className="r">{s.rate == null ? "—" : <Chip c={[s.rate >= 0.9 ? "ok" : bad ? "bad" : "warn", pct(s.rate)]} />}</td>
      <td className="r">{fmtMin(s.avgFrtMin)}</td>
      <td className="r">{s.within}/{s.answered + s.breached}</td>
      <td className="r">{s.missed ? <b className="neg">{s.missed}</b> : 0}</td>
    </>
  );
}

function Bars({ rows, color }: { rows: [string, number][]; color: string }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return <div className="kc-bars">{rows.length === 0 && <div className="kv">Chưa có dữ liệu.</div>}{rows.map(([l, n]) => <div key={l} className="kc-br"><span className="kc-bl" title={l}>{l}</span><span className="kc-bt2"><span style={{ width: `${(n / max) * 100}%`, background: color }} /></span><b>{n}</b></div>)}</div>;
}

export default function StatsPane() {
  const { me, staff } = useActor();
  const admin = me.role === "admin";
  const [period, setPeriod] = useState("7d");
  const [channel, setChannel] = useState("");
  const [who, setWho] = useState("");
  const [d, setD] = useState<Statistics | null>(null);
  const [chans, setChans] = useState<{ id: string; name: string }[]>([]);

  const load = useCallback(async () => {
    const r = periodRange(period);
    const p = new URLSearchParams({ from: String(r.from), to: String(r.to) });
    if (channel) p.set("channel", channel);
    if (who && admin) p.set("staff", who);
    const res = await fetch(`/api/stats?${p}`, { cache: "no-store" });
    if (res.ok) setD(await res.json());
  }, [period, channel, who, admin]);
  useEffect(() => { load(); const t = setInterval(() => { if (!document.hidden) load(); }, 30000); return () => clearInterval(t); }, [load]);
  useEffect(() => { fetch("/api/inbox?status=all", { cache: "no-store" }).then((r) => r.json()).then((j) => setChans((j.channels ?? []).filter((c: { off: boolean }) => !c.off))).catch(() => undefined); }, []);

  const staffCols = useMemo(() => [...new Set((d?.cross ?? []).flatMap((c) => Object.keys(c.counts)))].sort(), [d]);
  if (!d) return <div className="kv">Đang tải thống kê...</div>;
  const C = d.cards;
  const slaTone = C.slaRate == null ? "" : C.slaRate >= 0.9 ? "o" : C.slaRate >= 0.8 ? "w" : "b";
  const stats: [string, string | number, string][] = [
    ["Hội thoại", C.conversations, ""], ["Đang mở", C.open, ""], ["Chưa trả lời", C.unanswered, C.unanswered ? "w" : ""], ["Chưa nhận", C.unassigned, C.unassigned ? "w" : ""],
    ["Đạt SLA", C.slaAny ? pct(C.slaRate) : "Chưa cài", C.slaAny ? slaTone : ""], ["Phản hồi đầu TB", C.slaAny ? fmtMin(C.avgFrtMin) : "Chưa cài", ""],
    ["Bỏ lỡ", C.slaAny ? C.missed : "Chưa cài", C.missed ? "b" : ""], ["Nhận khách TB", fmtMin(C.avgClaimMin), ""],
  ];
  const summary = `${C.conversations} hội thoại · đạt SLA ${C.slaAny ? pct(C.slaRate) : "chưa cài"} · chưa trả lời ${C.unanswered} · chưa nhận ${C.unassigned}`;

  return (
    <>
      <FilterBar summary={`${PERIODS.find(([k]) => k === period)?.[1]} · ${channel ? chans.find((c) => c.id === channel)?.name : "mọi kênh"}`}>
        <label>Kỳ xem<Select value={period} options={PERIODS} onChange={setPeriod} /></label>
        <label>Kênh<Select value={channel} options={[["", `Tất cả kênh (${chans.length})`], ...chans.map((c) => [c.id, c.name] as [string, string])]} onChange={setChannel} /></label>
        {admin && <label>Nhân viên<Select value={who} options={[["", "Mọi nhân viên"], ...staff.filter((s) => s.role === "agent").map((s) => [s.uid, s.name] as [string, string])]} onChange={setWho} /></label>}
        <span className="info" title="Hội thoại được tính nếu có hoạt động trong kỳ. SLA đo từ lúc khách nhắn đến khi shop trả lời, chỉ tính trong giờ làm việc nếu kênh có đặt giờ. Tin gửi từ ứng dụng ngoài KP Chat tính cho người phụ trách hội thoại.">ⓘ</span>
      </FilterBar>
      <Collapse id="kc-stats" summary={summary} status={<>Cập nhật {new Date().toLocaleTimeString("vi-VN")}</>}>
        <div className="strip">
          {stats.map(([t, v, tone]) => <div key={t} className={`stat ${tone}`}><small>{t}</small><b>{v}</b></div>)}
        </div>
      </Collapse>
      {d.scope === "self" && <div className="note i">Bạn đang xem số liệu của riêng mình.</div>}
      {!C.slaAny && <div className="note i">Chưa cài SLA cho kênh nào nên chưa có số đạt SLA, thời gian phản hồi và bỏ lỡ. {admin ? "Vào Cài đặt > SLA theo kênh để đặt ngưỡng." : "Nhờ quản trị cài SLA."}</div>}

      <h3 style={{ margin: "12px 0 8px", fontSize: 15 }}>Theo kênh</h3>
      <div className="tw m stick rt">
        <table>
          <thead><tr><th>Kênh</th><th className="r">Hội thoại</th><th className="r">Đang mở</th><th className="r">Chưa trả lời</th><th className="r">Chưa nhận</th><th className="r">Đã xong</th><th className="r">Đạt SLA</th><th className="r">Phản hồi đầu TB</th><th className="r">Đạt / tổng</th><th className="r">Bỏ lỡ</th></tr></thead>
          <tbody>
            {d.byChannel.map((c) => (
              <tr key={c.id}><td className="nm"><b>{c.name}</b><span className="small">{KIND[c.kind]}</span></td><td className="r">{c.conversations}</td><td className="r">{c.open}</td><td className="r">{c.unanswered ? <b className="neg">{c.unanswered}</b> : 0}</td><td className="r">{c.unassigned}</td><td className="r">{c.done}</td><SlaCells s={c.sla} /></tr>
            ))}
            {d.byChannel.length === 0 && <tr><td colSpan={10} className="kv" style={{ padding: 20, textAlign: "center" }}>Chưa có dữ liệu trong kỳ này.</td></tr>}
          </tbody>
        </table>
      </div>

      <h3 style={{ margin: "14px 0 8px", fontSize: 15 }}>Theo nhân viên</h3>
      <div className="tw m stick rt">
        <table>
          <thead><tr><th>Nhân viên</th><th className="r">Đang giữ</th><th className="r">Đã xong</th><th className="r">Chưa trả lời</th><th className="r">Nhận khách TB</th><th className="r">Đạt SLA</th><th className="r">Phản hồi đầu TB</th><th className="r">Đạt / tổng</th><th className="r">Bỏ lỡ</th></tr></thead>
          <tbody>
            {d.byStaff.map((s) => (
              <tr key={s.uid}><td className="nm"><b>{staffLabel(staff, s.uid)}</b></td><td className="r">{s.open}</td><td className="r">{s.done}</td><td className="r">{s.unanswered ? <b className="neg">{s.unanswered}</b> : 0}</td><td className="r">{fmtMin(s.avgClaimMin)}</td><SlaCells s={s.sla} /></tr>
            ))}
            {d.byStaff.length === 0 && <tr><td colSpan={9} className="kv" style={{ padding: 20, textAlign: "center" }}>Chưa có dữ liệu trong kỳ này.</td></tr>}
          </tbody>
        </table>
      </div>

      {d.slaDetail.length > 0 && (
        <>
          <h3 style={{ margin: "14px 0 8px", fontSize: 15 }}>SLA từng người theo từng kênh <span className="kv">chỉ các kênh đã cài SLA</span></h3>
          <div className="tw m stick rt">
            <table>
              <thead><tr><th>Kênh</th><th>Nhân viên</th><th className="r">Ngưỡng</th><th className="r">Đạt SLA</th><th className="r">Phản hồi đầu TB</th><th className="r">Đạt / tổng</th><th className="r">Bỏ lỡ</th><th className="r">Các lượt sau TB</th></tr></thead>
              <tbody>
                {d.slaDetail.map((r) => (
                  <tr key={r.uid + r.channelId}><td className="nm"><b>{r.channelName}</b></td><td>{staffLabel(staff, r.uid)}</td><td className="r">{r.limitMin} phút{r.hours ? " (giờ làm việc)" : ""}</td><SlaCells s={r.sla} /><td className="r">{fmtMin(r.sla.avgLaterMin)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {admin && d.cross.length > 0 && (
        <>
          <h3 style={{ margin: "14px 0 8px", fontSize: 15 }}>Kênh × nhân viên <span className="kv">hội thoại đang mở</span></h3>
          <div className="tw m stick rt">
            <table>
              <thead><tr><th>Kênh</th>{staffCols.map((u) => <th key={u} className="r">{u ? staffLabel(staff, u) : "Chưa nhận"}</th>)}</tr></thead>
              <tbody>{d.cross.map((c) => <tr key={c.channelName}><td className="nm"><b>{c.channelName}</b></td>{staffCols.map((u) => <td key={u} className="r">{c.counts[u] ?? "–"}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </>
      )}

      <div className="ov-g2" style={{ marginTop: 14 }}>
        <div className="kc-box2"><h4>Theo nhãn</h4><Bars color="#9333EA" rows={d.byLabel} /></div>
        <div className="kc-box2"><h4>Tin khách theo ngày</h4><Bars color="#0E9F6E" rows={d.byDay} /></div>
      </div>
      <div className="kv" style={{ marginTop: 8 }}>Phản hồi đầu: từ tin đầu của khách (hoặc tin sau khi im lặng quá 4 giờ) đến tin trả lời đầu tiên. Ghi chú nội bộ không tính là trả lời. Đạt SLA = số lượt trả lời trong ngưỡng ÷ số lượt đã trả lời và số lượt chưa trả lời đã quá ngưỡng.</div>
    </>
  );
}
