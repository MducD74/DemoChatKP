"use client";
/* Chọn kênh ở góc cột 1: tick được nhiều kênh một lúc. "Nhóm kênh" là cách gộp vài kênh để chọn một lần (mỗi người tự đặt nhóm cho mình):
   chọn từ hai kênh trở lên thì hiện ô đặt tên để lưu thành nhóm; bấm một nhóm là chọn đúng các kênh của nhóm. */
import { useEffect, useRef, useState } from "react";
import { sameSet, selectionText, type ChannelGroup } from "@/core/channelgroups";

export interface PickChannel { id: string; name: string; kind: string; count: number }

export default function ChannelPicker({ channels, groups, value, onChange, onGroups }: { channels: PickChannel[]; groups: ChannelGroup[]; value: string[]; onChange: (v: string[]) => void; onGroups: (g: ChannelGroup[]) => Promise<string> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [del, setDel] = useState(""); // nhóm đang chờ bấm lần hai để xóa
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  const names = Object.fromEntries(channels.map((c) => [c.id, c.name]));
  const text = selectionText(value, groups, names, channels.length);
  const matched = groups.some((g) => sameSet(g.channelIds, value));
  const toggle = (id: string, on: boolean) => onChange(on ? [...value, id] : value.filter((x) => x !== id));
  async function saveGroup() {
    setErr("");
    const e = await onGroups([...groups, { id: "", name, channelIds: value }]);
    if (e) setErr(e); else setName("");
  }
  return (
    <div className="kc-cp" ref={box}>
      <button type="button" className={`kc-cp-b${value.length ? " on" : ""}`} aria-haspopup="listbox" aria-expanded={open} title="Chọn kênh, tick được nhiều kênh" onClick={() => setOpen(!open)}><span>{text}</span><i aria-hidden="true">▾</i></button>
      {open && (
        <div className="kc-cp-m" role="listbox" aria-multiselectable="true" aria-label="Kênh">
          <label className="kc-cp-i"><input type="checkbox" checked={value.length === 0} onChange={() => onChange([])} /><b>Tất cả kênh</b><em>{channels.length}</em></label>
          {groups.length > 0 && <div className="kc-cp-h">Nhóm kênh</div>}
          {groups.map((g) => (
            <div key={g.id} className={`kc-cp-g${sameSet(g.channelIds, value) ? " on" : ""}`}>
              <button type="button" onClick={() => onChange(g.channelIds.filter((id) => names[id]))} title={g.channelIds.map((id) => names[id] ?? "").filter(Boolean).join(", ")}><span>{g.name}</span><em>{g.channelIds.length} kênh</em></button>
              <button type="button" className="kc-cp-x" aria-label={`Xóa nhóm ${g.name}`} title={del === g.id ? "Bấm lần nữa để xóa nhóm" : "Xóa nhóm (kênh vẫn giữ nguyên)"} onClick={async () => { if (del !== g.id) { setDel(g.id); return; } setDel(""); const e = await onGroups(groups.filter((x) => x.id !== g.id)); if (e) setErr(e); }}>{del === g.id ? "Xóa?" : "×"}</button>
            </div>
          ))}
          <div className="kc-cp-h">Kênh</div>
          {channels.map((c) => (
            <label key={c.id} className="kc-cp-i" role="option" aria-selected={value.includes(c.id)}>
              <input type="checkbox" checked={value.includes(c.id)} onChange={(e) => toggle(c.id, e.target.checked)} /><span>{c.name}</span><em>{c.count}</em>
            </label>
          ))}
          {channels.length === 0 && <div className="kv" style={{ padding: "6px 10px" }}>Chưa có kênh nào.</div>}
          {value.length >= 2 && !matched && (
            <div className="kc-cp-f">
              <span>Đặt gộp {value.length} kênh đang chọn thành một nhóm</span>
              <div><input value={name} maxLength={30} placeholder="Tên nhóm, ví dụ: Facebook XuXi" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) void saveGroup(); }} /><button type="button" className="btn p" disabled={!name.trim()} onClick={() => void saveGroup()}>Lưu nhóm</button></div>
              {err && <em className="bad">{err}</em>}
            </div>
          )}
          {(value.length < 2 || matched) && err && <div className="kc-cp-f"><em className="bad">{err}</em></div>}
        </div>
      )}
    </div>
  );
}
