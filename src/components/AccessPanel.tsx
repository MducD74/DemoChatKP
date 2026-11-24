"use client";
/* Phân quyền theo kênh: mỗi kênh một thẻ, chọn nhân viên được vào và mức Nhắn tin hoặc Chỉ xem (khuôn của KP Chat 1.1, lớp .kcp-*). */
import { useCallback, useEffect, useState } from "react";
import type { ChannelView } from "@/core/connect";
import { useActor } from "./actor";

const KIND: Record<string, string> = { facebook: "Messenger", instagram: "Instagram", zalo_oa: "Zalo OA", zalo_personal: "Zalo cá nhân", web: "Web chat", tiktok: "TikTok" };
const COLOR: Record<string, string> = { facebook: "#1877F2", instagram: "#DB2777", zalo_oa: "#0068FF", zalo_personal: "#0EA5E9", web: "#0F766E", tiktok: "#111" };
type Level = "send" | "view";

async function api(url: string, method = "GET", body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  return r.json().catch(() => ({}));
}
const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 45% 45%)`; };

export default function AccessPanel() {
  const { staff } = useActor();
  const agents = staff.filter((s) => s.role === "agent");
  const [rows, setRows] = useState<ChannelView[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const load = useCallback(async () => setRows(((await api("/api/channels")).channels ?? []).filter((c: ChannelView) => !c.off)), []);
  useEffect(() => { load(); }, [load]);

  async function save(c: ChannelView, access: Record<string, Level>) {
    setRows((rs) => rs.map((r) => (r.id === c.id ? { ...r, access } : r)));
    const r = await api(`/api/channels/${c.id}/access`, "PUT", { access });
    setMsg((m) => ({ ...m, [c.id]: r.ok ? "Đã lưu" : r.error ?? "Lỗi" }));
    if (!r.ok) load();
  }

  return (
    <div className="kcp">
      <p className="kcp-lead">Chọn <b>nhân viên được vào từng kênh</b>. <span className="kcp-tip" title="Nhắn tin: xem, nhận khách, trả lời, ghi chú. Chỉ xem: chỉ đọc, không nhận khách, không trả lời.">Nhắn tin và Chỉ xem khác nhau thế nào?</span> Trong kênh, nhân viên thấy hội thoại của mình và hội thoại chưa ai nhận. Quản trị luôn thấy tất cả.</p>
      {rows.length === 0 && <div className="kv">Chưa có kênh nào. Thêm kênh ở mục Kết nối kênh.</div>}
      <div className="kcp-list">
        {rows.map((c) => {
          const people = Object.entries(c.access);
          const free = agents.filter((a) => !c.access[a.uid]);
          return (
            <div key={c.id} className="kcp-card">
              <header>
                <span className="kcp-pf" style={{ background: COLOR[c.kind] ?? "#64748B" }}>{(KIND[c.kind] ?? "?")[0]}</span>
                <div className="kcp-t"><b>{c.name}</b><small>{KIND[c.kind]} · {people.length ? `${people.filter(([, l]) => l === "send").length} người nhắn tin, ${people.filter(([, l]) => l === "view").length} chỉ xem` : "chưa chọn ai"}</small></div>
              </header>
              {people.length === 0 && <div className="kcp-note">Chưa chọn nhân viên nào: hiện chỉ quản trị thấy kênh này.</div>}
              <div className="kcp-ppl">
                {people.map(([uid, lv]) => (
                  <span key={uid} className="kcp-chip">
                    <i style={{ background: hue(uid) }}>{(agents.find((a) => a.uid === uid)?.name ?? uid)[0]}</i>
                    {agents.find((a) => a.uid === uid)?.name ?? uid}
                    <button className={`lv ${lv === "view" ? "v" : ""}`} title="Bấm để đổi mức" onClick={() => save(c, { ...c.access, [uid]: lv === "send" ? "view" : "send" })}>{lv === "send" ? "Nhắn tin" : "Chỉ xem"}</button>
                    <button className="x" aria-label="Bỏ khỏi kênh" onClick={() => { const n = { ...c.access }; delete n[uid]; save(c, n); }}>×</button>
                  </span>
                ))}
                <button className={`kcp-add ${pick === c.id ? "on" : ""}`} disabled={free.length === 0} onClick={() => setPick(pick === c.id ? null : c.id)}>+ Thêm nhân viên</button>
              </div>
              {pick === c.id && free.length > 0 && (
                <div className="kcp-pick">
                  <div className="kcp-rows">
                    {free.map((a) => <button key={a.uid} onClick={() => { save(c, { ...c.access, [a.uid]: "send" }); setPick(null); }}><i style={{ background: hue(a.uid) }}>{a.name[0]}</i><span>{a.name}</span><em>+</em></button>)}
                  </div>
                </div>
              )}
              <div className="kcp-foot"><span className="kcp-msg">{msg[c.id] ?? ""}</span></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
