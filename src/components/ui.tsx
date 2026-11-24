"use client";
/* Thành phần giao diện chuẩn, sao từ KPF (src/components/ui.tsx) với đúng tên, tham số và lớp CSS.
   Khi gắn KP Chat vào KPF/KP Travel: xóa file này, đổi import sang "@/components/ui" của dự án đích. */

import { createPortal } from "react-dom";
import { useEffect, useState, type ReactNode } from "react";

export const ICO = {
  home: "M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  sync: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5",
  chart: "M3 3v18h18M7 16V9M12 16V5M17 16v-4",
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4z",
  x: "M18 6L6 18M6 6l12 12",
  undo: "M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  plus: "M12 5v14M5 12h14",
  eye: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  down: "M12 3v12M7 10l5 5 5-5M4 21h16",
  expand: "M7 15l5 5 5-5M7 9l5-5 5 5",
  wrench: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z",
  edit: "M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z",
  cols: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  chat: "M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 1 1 21 11.5z",
  tag: "M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01",
  // bổ sung cho KP Chat (cùng kiểu nét mảnh)
  clip: "M21.4 11.1l-9.2 9.2a5.5 5.5 0 0 1-7.8-7.8l9.2-9.2a3.7 3.7 0 0 1 5.2 5.2l-9.2 9.2a1.8 1.8 0 0 1-2.6-2.6l8.5-8.5",
  img: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21",
  note: "M4 4h16v12l-4 4H4zM16 20v-4h4M8 9h8M8 13h5",
  bolt: "M13 2L4 14h7l-1 8 9-12h-7z",
  link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  trash: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6",
  check: "M5 12l5 5L20 7",
  smile: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01",
  panel: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM15 3v18",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5",
  play: "M8 5v14l11-7z",
} as const;
export type IconName = keyof typeof ICO;

export function Ic({ n }: { n: IconName }) {
  return (
    <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICO[n]} />
    </svg>
  );
}

export type ChipKind = "ok" | "warn" | "bad" | "mute" | "pend";
export function Chip({ c }: { c: [ChipKind, string] }) {
  return <span className={`chip ${c[0]}`}>{c[1]}</span>;
}

export function Modal({ title, onClose, children, footer, small, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; small?: boolean; wide?: boolean }) {
  return (
    <div className="ov" role="dialog" aria-modal="true">
      <div className={`modal ${small ? "s" : ""} ${wide ? "w" : ""}`}>
        <div className="mh">{title}<span className="sp" /><button type="button" className="btn sm" onClick={onClose} aria-label="Đóng"><Ic n="x" /></button></div>
        {children}
        {footer && <div className="mf">{footer}</div>}
      </div>
    </div>
  );
}

export function Select({ value, options, onChange, disabled }: { value: string; options: [string, string][]; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
    </select>
  );
}

/* trạng thái giao diện nhớ theo trình duyệt (vd thu gọn khối số liệu của từng trang); chặn lưu trữ thì dùng mặc định */
export function usePersist<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(init);
  useEffect(() => {
    try { const raw = localStorage.getItem(`kpf.ui.${key}`); if (raw != null) setV(JSON.parse(raw) as T); } catch { /* dùng mặc định */ }
  }, [key]);
  const set = (n: T) => { setV(n); try { localStorage.setItem(`kpf.ui.${key}`, JSON.stringify(n)); } catch { /* bỏ qua */ } };
  return [v, set];
}

/* tab của trang đặt ngay cạnh tiêu đề trên thanh đầu trang (Shell chừa sẵn chỗ #top-slot) */
export function TopTabs<T extends string>({ value, options, onChange }: { value: T; options: [T, ReactNode][]; onChange: (v: T) => void }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => { setEl(document.getElementById("top-slot")); }, []);
  if (!el) return null;
  return createPortal(
    <div className="toptabs" role="tablist">
      {options.map(([v, t]) => <button key={v} type="button" role="tab" aria-selected={value === v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>{t}</button>)}
    </div>, el);
}

/* khối số liệu có nút thu gọn; thu gọn thì còn một dòng tóm tắt, nhớ trạng thái theo từng trang */
export function Collapse({ id, summary, head, status, tools, inline, children }: { id: string; summary: ReactNode; head?: ReactNode; status?: ReactNode; tools?: ReactNode; inline?: boolean; children: ReactNode }) {
  const [shut, setShut] = usePersist<boolean>(`collapse.${id}`, false);
  return (
    <>
      <div className={`clp ${inline ? "in" : ""}`}>
        {head}
        {head && <span className="sp" />}
        <button type="button" className="btn sm" onClick={() => setShut(!shut)} aria-expanded={!shut}>{shut ? "▸ Số liệu" : "▾ Số liệu"}</button>
        {shut && <span className="kv clp-s">{summary}</span>}
        {inline && !shut && children}
        {(status || tools) && <><span className="sp" />{status && <span className="clp-st">{status}</span>}{tools && <div className="clp-t">{tools}</div>}</>}
      </div>
      {!inline && !shut && children}
    </>
  );
}

/* thanh lọc đầu trang: máy tính hiện đủ; điện thoại chỉ còn một dòng tóm tắt + nút Bộ lọc, giữ lại ô tìm và nút chính (keep) */
export function FilterBar({ summary, keep, children, className }: { summary: ReactNode; keep?: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`fb ${open ? "open" : ""}${className ? ` ${className}` : ""}`}>
      <button type="button" className="fb-t" onClick={() => setOpen(!open)} aria-expanded={open}><span>{summary}</span><b>{open ? "Thu gọn ▴" : "Bộ lọc ▾"}</b></button>
      <div className="fb-in">{children}</div>
      {keep && <div className="fb-keep">{keep}</div>}
    </div>
  );
}

/* chọn cột hiển thị của một bảng */
export function ColPicker({ cols, hidden, onToggle, onReset }: { cols: string[]; hidden: string[]; onToggle: (c: string) => void; onReset: () => void }) {
  return (
    <details className="colpick ls">
      <summary className="btn tbn ic" title="Cột hiển thị" aria-label="Cột hiển thị"><Ic n="cols" /></summary>
      <div className="pop">
        <h6>Cột trong bảng</h6>
        {cols.map((c) => <label key={c}><input type="checkbox" checked={!hidden.includes(c)} onChange={() => onToggle(c)} /> {c}</label>)}
        <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={onReset}>Đặt lại mặc định</button>
      </div>
    </details>
  );
}

/* Kpi: thẻ số liệu của trang tổng quan (sao từ OvParts.tsx của KPF) */
export function Kpi({ cls, label, value, small, foot, children }: { cls?: string; label: string; value: ReactNode; small?: string; foot?: ReactNode; children?: ReactNode }) {
  return (
    <div className={`ov-kpi ${cls ?? ""}`}>
      <div className="l">{label}</div>
      <div className="v">{value}{small && <small>{small}</small>}</div>
      <div className="d">{foot}</div>
      {children}
    </div>
  );
}
