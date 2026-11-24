"use client";
/* Bảng "Mẫu trả lời" phía trên ô soạn, theo KP Chat 1: tìm mẫu, mỗi dòng có ký tự tắt, nội dung, số nội dung và ảnh nhỏ của mẫu; bấm một mẫu để điền vào ô soạn. */
import { useEffect, useState } from "react";
import type { Template } from "@/core/store";
import { Ic } from "./ui";
import type { Lib } from "./LibraryPane";

export default function QuickPanel({ templates, lib, admin, onUse, onClose, onEdit }: { templates: Template[]; lib: Lib | null; admin: boolean; onUse: (t: Template) => void; onClose: () => void; onEdit: () => void }) {
  const [q, setQ] = useState("");
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  const url = (id: string) => lib?.items.find((x) => x.id === id)?.url ?? "";
  const k = q.trim().toLowerCase();
  const list = templates.filter((t) => !k || `${t.key} ${t.blocks.map((b) => b.text).join(" ")}`.toLowerCase().includes(k));
  return (
    <div className="kc-cl" role="dialog" aria-label="Mẫu trả lời">
      <div className="kc-clh">
        <div className="kc-seg"><button type="button" className="on"><Ic n="chat" /> Mẫu trả lời{templates.length ? <em>{templates.length}</em> : null}</button></div>
        <div className="kc-sbox"><Ic n="eye" /><input type="search" value={q} autoFocus onChange={(e) => setQ(e.target.value)} placeholder="Tìm mẫu" aria-label="Tìm mẫu" /></div>
        {admin && <button type="button" className="kc-ib" title="Sửa mẫu trả lời" aria-label="Sửa mẫu trả lời" onClick={onEdit}><Ic n="edit" /></button>}
        <button type="button" className="kc-ib" title="Đóng" aria-label="Đóng" onClick={onClose}><Ic n="x" /></button>
      </div>
      <div className="kc-clb">
        {list.length === 0 && <div className="kc-ce"><Ic n="chat" /><span>{templates.length ? "Không có mẫu nào khớp" : admin ? "Chưa có mẫu. Bấm biểu tượng bút để thêm mẫu." : "Chưa có mẫu. Nhờ quản trị thêm mẫu."}</span></div>}
        {list.map((t) => {
          const ids = t.blocks.flatMap((b) => b.images);
          return (
            <button key={t.id} type="button" className="kc-cr" onClick={() => onUse(t)}>
              <b>/{t.key}</b>
              <span className="kc-qtxt">{t.blocks.map((b) => b.text).filter(Boolean).join(" · ") || "(chỉ có ảnh)"}</span>
              {t.blocks.length > 1 && <em className="kc-qn">{t.blocks.length} nội dung</em>}
              {ids.length > 0 && <span className="kc-qimgs">{url(ids[0]) && /* eslint-disable-next-line @next/next/no-img-element */ <img src={url(ids[0])} alt="" />}{ids.length > 1 && <em>+{ids.length - 1}</em>}</span>}
            </button>
          );
        })}
      </div>
      <div className="kc-cf"><span className="kv">Bấm một mẫu để điền vào ô soạn</span><button type="button" className="kc-ghost" onClick={onClose}>Xong</button></div>
    </div>
  );
}
