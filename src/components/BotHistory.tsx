"use client";
/* Lịch sử của một chatbot (trang riêng của chatbot): số liệu của chính chatbot này và các nháp, tin đã soạn gần đây. Chỉ đọc. */
import { useEffect, useState } from "react";

interface Stats { last24h: number; auto: number; used: number; edited: number; discarded: number; pending: number; handoff: number; shadow: number; errors: number; tokensIn: number; tokensOut: number }
interface Outcome { convs: number; withPhone: number; handoffs: number; phoneRate: number; handoffRate: number }
interface Row { id: string; at: number; status: string; kind: "reply" | "handoff"; shadow: boolean; asked: boolean; text: string; reason?: string; conversationId: string; contact: string; channel: string }

const STATUS: Record<string, string> = { pending: "Chờ duyệt", used: "Dùng nguyên văn", edited: "Đưa vào sửa", discarded: "Bỏ", stale: "Quá cũ", error: "Lỗi", auto: "Tự gửi", handed: "Đã chuyển người" };
const when = (t: number) => new Date(t).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function BotHistory({ botId, stats, outcome }: { botId: string; stats: Stats; outcome?: Outcome }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    fetch(`/api/bot/history?botId=${encodeURIComponent(botId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!live) return; if (j.ok) setRows(j.rows); else setErr(j.error ?? "Không tải được"); })
      .catch(() => live && setErr("Không tải được"));
    return () => { live = false; };
  }, [botId]);

  return (
    <div className="kcp">
      <div className="kcp-card">
        <header><div className="kcp-t"><b>Kết quả của chatbot này</b><small>Chỉ tính các nháp và tin do chính chatbot này soạn</small></div></header>
        <div className="kcp-kpis">
          <div><span>Nháp trong 24 giờ</span><b>{stats.last24h}</b></div>
          <div><span>Chatbot tự gửi</span><b>{stats.auto}</b></div>
          <div><span>Dùng nguyên văn</span><b>{stats.used}</b></div>
          <div><span>Đưa vào sửa</span><b>{stats.edited}</b></div>
          <div><span>Bỏ</span><b>{stats.discarded}</b></div>
          <div><span>Đang chờ duyệt</span><b>{stats.pending}</b></div>
          <div><span>Đề nghị chuyển người</span><b>{stats.handoff}</b></div>
          <div><span>Lỗi gọi mô hình</span><b>{stats.errors}</b></div>
          <div title="Số cuộc chat chatbot có soạn trong 30 ngày"><span>Cuộc chat 30 ngày</span><b>{outcome?.convs ?? 0}</b></div>
          <div title="Cuộc chat khách để lại số điện thoại, tính từ lúc chatbot vào cuộc"><span>Có số điện thoại</span><b>{outcome ? `${outcome.withPhone} (${outcome.phoneRate}%)` : "0"}</b></div>
        </div>
      </div>
      <div className="kcp-card">
        <header><div className="kcp-t"><b>Gần đây</b><small>{rows ? `${rows.length} lần soạn mới nhất` : "Đang tải..."}</small></div></header>
        {err && <div className="kcb-err">{err}</div>}
        {rows && rows.length === 0 && <div className="kv">Chatbot này chưa soạn gì. Khi có khách nhắn ở kênh đã gắn, các nháp sẽ hiện ở đây.</div>}
        {rows && rows.length > 0 && (
          <div className="tw m rt">
            <table className="kcb-hist">
              <thead><tr><th>Lúc</th><th>Khách</th><th>Chatbot soạn</th><th>Kết quả</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="kv">{when(r.at)}</td>
                    <td><b>{r.contact}</b><div className="kv">{r.channel}</div></td>
                    <td className="kcb-hist-t">{r.kind === "handoff" ? <i>Đề nghị chuyển người{r.reason ? `: ${r.reason}` : ""}</i> : r.status === "error" ? <span className="kce-no">Lỗi: {r.reason}</span> : r.text}{r.shadow && <div className="kv">Gợi ý tham khảo, không gửi</div>}{r.asked && <div className="kv">Nhân viên bấm Gợi ý tin nhắn</div>}</td>
                    <td>{STATUS[r.status] ?? r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
