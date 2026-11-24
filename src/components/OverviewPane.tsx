"use client";
/* Mục Tổng quan (chỉ quản trị): việc cần xử lý ngay, cảnh báo kênh, tải của nhân viên. Dùng Kpi, .ov-g*, tw, Chip như các trang tổng quan của KPF. */
import { useCallback, useEffect, useState } from "react";
import type { Overview } from "@/core/stats";
import { Chip, Kpi, type ChipKind } from "./ui";
import { staffLabel, useActor } from "./actor";

const KIND: Record<string, string> = { facebook: "Messenger", instagram: "Instagram", zalo_oa: "Zalo OA", zalo_personal: "Zalo cá nhân", web: "Web chat", tiktok: "TikTok" };
const STAT: Record<string, [ChipKind, string]> = { connected: ["ok", "Đã kết nối"], pending: ["pend", "Chờ cấp quyền"], no_token: ["warn", "Chưa có token"], expired: ["bad", "Hết hạn"] };
const waitText = (m: number) => (m < 60 ? `${m} phút` : m < 1440 ? `${Math.floor(m / 60)} giờ ${m % 60} phút` : `${Math.floor(m / 1440)} ngày`);

export default function OverviewPane({ onOpen, goChannels }: { onOpen: (id: string) => void; goChannels: () => void }) {
  const { staff } = useActor();
  const [d, setD] = useState<Overview | null>(null);
  const [at, setAt] = useState(0);
  const load = useCallback(async () => {
    const r = await fetch("/api/overview", { cache: "no-store" });
    if (r.ok) { setD(await r.json()); setAt(Date.now()); }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 10000);
    return () => clearInterval(t);
  }, [load]);

  if (!d) return <div className="kv">Đang tải tổng quan...</div>;
  const T = d.totals;
  const staffRows = [...d.staff].sort((a, b) => b.waiting - a.waiting || b.open - a.open);
  return (
    <>
      {d.alerts.length === 0 && <div className="note i">Mọi thứ đang ổn: không có khách chờ lâu, các kênh đều hoạt động.</div>}
      {d.alerts.some((a) => a.level === "bad") && (
        <div className="note" style={{ background: "var(--bad-bg)", color: "#991B1B" }}>
          {d.alerts.filter((a) => a.level === "bad").map((a, i) => <div key={i}>{a.text}</div>)}
        </div>
      )}
      {d.alerts.some((a) => a.level === "warn") && (
        <div className="note">
          {d.alerts.filter((a) => a.level === "warn").map((a, i) => (
            <div key={i}>{a.text} {a.channelId && <button type="button" className="btn sm" onClick={goChannels}>Mở mục Kênh</button>}</div>
          ))}
        </div>
      )}

      <div className="ov-g5">
        <Kpi label="Chưa có người nhận" value={<span style={T.unassigned ? { color: "var(--warn)" } : undefined}>{T.unassigned}</span>} foot="hội thoại đang mở" />
        <Kpi label="Khách đang chờ trả lời" value={T.waiting} foot={`${T.open} hội thoại đang mở`} />
        <Kpi label="Vượt SLA" value={T.slaAny ? <span className={T.slaBreach ? "neg" : ""}>{T.slaBreach}</span> : "—"} foot={!T.slaAny ? "chưa cài SLA" : T.slaBreach ? "cần trả lời ngay" : "không có"} />
        <Kpi label="Sắp vượt SLA" value={T.slaAny ? <span style={T.slaSoon ? { color: "var(--warn)" } : undefined}>{T.slaSoon}</span> : "—"} foot={T.slaAny ? "đã chờ gần đến ngưỡng" : "chưa cài SLA"} />
        <Kpi label="Đã xong hôm nay" value={<span style={{ color: "var(--ok)" }}>{T.resolvedToday}</span>} foot="hội thoại" />
      </div>

      {d.bot.used && (
        <div className="ov-g5">
          <Kpi label="Chatbot chuyển người, chờ xử lý" value={<span className={d.bot.needLate ? "neg" : undefined} style={!d.bot.needLate && d.bot.need ? { color: "var(--warn)" } : undefined}>{d.bot.need}</span>} foot={d.bot.needLate ? `${d.bot.needLate} đã chờ quá hạn` : d.bot.need ? "chưa ai nhận" : "không có"} />
          <Kpi label="Chatbot đã trả lời hôm nay" value={d.bot.repliesToday} foot="tin chatbot tự gửi" />
        </div>
      )}

      <div>
        <div>
          <h3 style={{ margin: "4px 0 8px", fontSize: 15 }}>Cần xử lý ngay <span className="kv">khách chờ lâu nhất</span></h3>
          <div className="tw m stick rt">
            <table>
              <thead><tr><th>Khách</th><th>Kênh</th><th>Tin cuối</th><th>Phụ trách</th><th>SLA</th><th className="r">Chờ</th></tr></thead>
              <tbody>
                {d.attention.map((r) => (
                  <tr key={r.id} className={`rowc ${r.sla?.state === "breach" ? "bad" : r.sla?.state === "soon" ? "warn" : ""}`} onClick={() => onOpen(r.id)}>
                    <td className="nm"><b>{r.contactName}</b></td>
                    <td>{r.channelName}<span className="small">{KIND[r.kind]}</span></td>
                    <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.lastText || "(đính kèm)"}</td>
                    <td>{r.assigneeUid ? staffLabel(staff, r.assigneeUid) : <Chip c={["warn", "Chưa nhận"]} />}</td>
                    <td>{r.sla ? <Chip c={r.sla.state === "breach" ? ["bad", `Vượt ${r.sla.limitMin} phút`] : r.sla.state === "soon" ? ["warn", "Sắp vượt"] : ["ok", "Trong ngưỡng"]} /> : <span className="kv">Chưa cài SLA</span>}</td>
                    <td className="r"><b className={r.sla?.state === "breach" ? "neg" : ""}>{waitText(r.waitMin)}</b></td>
                  </tr>
                ))}
                {d.attention.length === 0 && <tr><td colSpan={6} className="kv" style={{ padding: 20, textAlign: "center" }}>Không có khách nào đang chờ.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <h3 style={{ margin: "4px 0 8px", fontSize: 15 }}>Nhân viên</h3>
          <div className="tw m stick rt">
            <table>
              <thead><tr><th>Nhân viên</th><th className="r">Đang giữ</th><th className="r">Khách chờ</th></tr></thead>
              <tbody>
                {staffRows.map((s) => (
                  <tr key={s.uid}><td className="nm"><b>{staffLabel(staff, s.uid)}</b></td><td className="r">{s.open}</td><td className="r">{s.waiting ? <Chip c={["warn", String(s.waiting)]} /> : "0"}</td></tr>
                ))}
                {staffRows.length === 0 && <tr><td colSpan={3} className="kv" style={{ padding: 20, textAlign: "center" }}>Chưa có hội thoại nào được giao.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <h3 style={{ margin: "12px 0 8px", fontSize: 15 }}>Các kênh</h3>
      <div className="tw m stick rt">
        <table>
          <thead><tr><th>Kênh</th><th>Loại</th><th>Tình trạng</th><th>Gửi tin</th><th>SLA</th><th className="r">Đang mở</th><th className="r">Chưa nhận</th><th className="r">Chờ trả lời</th></tr></thead>
          <tbody>
            {d.channels.map((c) => (
              <tr key={c.id} className="rowc" onClick={goChannels}>
                <td className="nm"><b>{c.name}</b></td>
                <td>{KIND[c.kind]}</td>
                <td><Chip c={STAT[c.status]} /></td>
                <td><Chip c={c.sendEnabled ? ["ok", "Đang bật"] : ["mute", "Đang tắt"]} /></td>
                <td>{c.sla ? <Chip c={["ok", "Đã cài"]} /> : <span className="kv">Chưa cài</span>}</td>
                <td className="r">{c.open}</td><td className="r">{c.unassigned}</td><td className="r">{c.waiting}</td>
              </tr>
            ))}
            {d.channels.length === 0 && <tr><td colSpan={8} className="kv" style={{ padding: 20, textAlign: "center" }}>Chưa có kênh nào.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="kv" style={{ marginTop: 8 }}>Cập nhật {at ? new Date(at).toLocaleTimeString("vi-VN") : ""} · tự làm mới 10 giây</div>
    </>
  );
}
