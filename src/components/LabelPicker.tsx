"use client";
/* Hộp thả chọn nhãn để lọc (như ô Nhãn của KP Chat 1) nhưng chọn được nhiều nhãn: mỗi nhãn một ô tick kèm chấm màu.
   Đóng lại thì ô hiện "Tất cả nhãn", tên nhãn đã chọn, hoặc số nhãn. Chọn từ hai nhãn trở lên thì chọn được "một trong" hay "đủ" các nhãn. */
import { useEffect, useRef, useState } from "react";
import { labelViews, type LabelCfg } from "@/core/labels";

export default function LabelPicker({ cfg, used, value, all, onChange, onAll }: { cfg: LabelCfg; used: string[]; value: string[]; all: boolean; onChange: (v: string[]) => void; onAll: (v: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key, true); };
  }, [open]);
  const views = labelViews(cfg, used, { withHidden: true }).filter((l) => l.known || used.includes(l.name));
  const text = value.length === 0 ? "Tất cả nhãn" : value.length <= 2 ? value.join(", ") : `${value.length} nhãn`;
  return (
    <div className="kc-lp" ref={box}>
      <button type="button" className="kc-lp-b" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}><span>{text}</span><i aria-hidden="true">▾</i></button>
      {open && (
        <div className="kc-lp-m" role="listbox" aria-multiselectable="true" aria-label="Nhãn">
          <label className="kc-lp-i"><input type="checkbox" checked={value.length === 0} onChange={() => onChange([])} /><span>Tất cả nhãn</span></label>
          {views.length === 0 && <div className="kv" style={{ padding: "6px 10px" }}>Chưa có nhãn nào.</div>}
          {views.map((l) => (
            <label key={l.name} className="kc-lp-i" role="option" aria-selected={value.includes(l.name)}>
              <input type="checkbox" checked={value.includes(l.name)} onChange={(e) => onChange(e.target.checked ? [...value, l.name] : value.filter((x) => x !== l.name))} />
              <i className="kc-lp-d" style={{ background: l.color }} aria-hidden="true" /><span>{l.name}</span>
            </label>
          ))}
          {value.length > 1 && (
            <div className="kc-lp-f">
              <label><input type="radio" name="lp-mode" checked={!all} onChange={() => onAll(false)} /> Có một trong các nhãn</label>
              <label><input type="radio" name="lp-mode" checked={all} onChange={() => onAll(true)} /> Có đủ các nhãn</label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
