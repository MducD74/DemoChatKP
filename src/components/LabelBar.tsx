"use client";
/* Thanh nhãn phía trên ô soạn tin: một hàng các ô màu, bấm để gắn hoặc bỏ. Không chia nhóm. */
import { Ic, usePersist } from "./ui";
import { labelViews, toggleLabel, type LabelCfg } from "@/core/labels";

export default function LabelBar({ cfg, labels, canEdit, onChange }: { cfg: LabelCfg; labels: string[]; canEdit: boolean; onChange: (next: string[]) => void }) {
  const [on, setOn] = usePersist<boolean>("kc.tagbar", true);
  const all = labelViews(cfg, labels);
  const attached = all.filter((l) => labels.includes(l.name));
  return (
    <div className="kc-tbw">
      <div className="kc-tbh">
        <button type="button" className="kc-tgt" onClick={() => setOn(!on)} title={on ? "Ẩn thanh nhãn" : "Hiện thanh nhãn"}><Ic n="tag" /> Nhãn{labels.length ? ` (${labels.length})` : ""} <span aria-hidden="true">{on ? "▾" : "▴"}</span></button>
        {!on && attached.map((t) => <span key={t.name} className="kc-chip on" style={{ "--c": t.color } as React.CSSProperties}>{t.name}</span>)}
        {on && (
          <div className="kc-chipsrow all">
            {all.length === 0 && <span className="kv">Chưa có nhãn nào. Quản trị thêm nhãn ở Cài đặt, mục Nhãn.</span>}
            {all.map((t) => {
              const has = labels.includes(t.name);
              return <button key={t.name} type="button" className={`kc-chip${has ? " on" : ""}`} style={{ "--c": t.color } as React.CSSProperties} disabled={!canEdit} title={has ? "Bấm để bỏ nhãn" : "Bấm để gắn nhãn"} onClick={() => onChange(toggleLabel(labels, t.name, !has, cfg))}>{has ? <Ic n="check" /> : <i />}{t.name}</button>;
            })}
          </div>
        )}
      </div>
    </div>
  );
}
