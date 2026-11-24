"use client";
/* Mục Nhật ký (chỉ quản trị): ai làm gì, lúc nào, trên hội thoại nào. Lọc theo người, từ khóa, chỉ các lần bị từ chối. Như tab Nhật ký của KP Chat 1. */
import { useEffect, useMemo, useState } from "react";
import { DENIED, type AuditRow } from "@/core/auditrow";
import { FilterBar, Select } from "./ui";

export default function AuditPane() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [who, setWho] = useState("");
  const [q, setQ] = useState("");
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    const load = () => fetch("/api/audit", { cache: "no-store" }).then((r) => r.json()).then((j) => setRows(j.rows ?? [])).catch(() => setRows([]));
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 15000);
    return () => clearInterval(t);
  }, []);
  const people = useMemo(() => [...new Set((rows ?? []).map((r) => r.who))].sort(), [rows]);
  const list = useMemo(() => (rows ?? []).filter((r) => (!who || r.who === who) && (!denied || r.action.startsWith(DENIED)) && (!q || `${r.action} ${r.target ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [rows, who, q, denied]);
  const filtered = !!who || denied || !!q;
  return (
    <>
      <FilterBar summary={filtered ? `${list.length} dòng khớp bộ lọc` : "Nhật ký thao tác"}>
        <label><span>Tìm</span><input type="search" placeholder="Hành động hoặc khách" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <label><span>Người</span><Select value={who} onChange={setWho} options={[["", "Mọi người"], ...people.map((p): [string, string] => [p, p])]} /></label>
        <label className="chk"><input type="checkbox" checked={denied} onChange={(e) => setDenied(e.target.checked)} /> Chỉ lần bị từ chối</label>
      </FilterBar>
      <div className="tw m stick rt">
        <table>
          <thead><tr><th>Thời gian</th><th>Người</th><th>Hành động</th><th>Đối tượng</th></tr></thead>
          <tbody>
            {rows === null && <tr><td colSpan={4} className="kv">Đang tải...</td></tr>}
            {rows && list.length === 0 && <tr><td colSpan={4} className="kv">Không có dòng nào.</td></tr>}
            {list.map((r, i) => (
              <tr key={`${r.at}-${i}`}>
                <td className="kv" data-l="Thời gian">{new Date(r.at).toLocaleString("vi-VN")}</td>
                <td data-l="Người">{r.who}</td>
                <td data-l="Hành động" style={r.action.startsWith(DENIED) ? { color: "var(--bad)", fontWeight: 600 } : undefined}>{r.action}</td>
                <td className="kv" data-l="Đối tượng">{r.target ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="kv">{rows ? `${list.length}/${rows.length} dòng gần nhất` : ""}</div>
    </>
  );
}
