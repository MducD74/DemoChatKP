"use client";
/* Cài đặt > Nhãn (chỉ quản trị): danh sách nhãn phẳng, mỗi nhãn có màu, ẩn, thứ tự. Không chia nhóm. */
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_LABEL_CFG, labelViews, type LabelCfg } from "@/core/labels";

export default function LabelsPanel() {
  const [cfg, setCfg] = useState<LabelCfg>(DEFAULT_LABEL_CFG);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [newL, setNewL] = useState("");
  const [q, setQ] = useState("");
  const [used, setUsed] = useState<Record<string, number>>({}); // nhãn đang gắn ở hội thoại và số lần

  useEffect(() => {
    fetch("/api/labels", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (j.cfg) setCfg(j.cfg); setLoaded(true); });
    fetch("/api/inbox?status=all", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      const m: Record<string, number> = {};
      for (const i of (j.items ?? []) as { labels: string[] }[]) for (const l of i.labels) m[l] = (m[l] ?? 0) + 1;
      setUsed(m);
    });
  }, []);

  const lastG = cfg.groups[cfg.groups.length - 1]?.name ?? "Nhãn";
  // nhãn đang gắn ở hội thoại mà chưa có trong danh mục: đề nghị thêm vào
  const unknown = Object.keys(used).filter((n) => !cfg.labels[n]);
  const rows = useMemo(() => labelViews(cfg, [], { withHidden: true }).filter((l) => !q || l.name.toLowerCase().includes(q.toLowerCase())), [cfg, q]);
  const set = (name: string, p: Partial<LabelCfg["labels"][string]>) => setCfg({ ...cfg, labels: { ...cfg.labels, [name]: { ...cfg.labels[name], ...p } } });
  function move(name: string, d: number) {
    const g = cfg.labels[name]?.group ?? lastG;
    const inG = labelViews(cfg, [], { withHidden: true }).filter((l) => l.group === g).map((l) => l.name);
    const i = inG.indexOf(name), j = i + d;
    if (j < 0 || j >= inG.length) return;
    [inG[i], inG[j]] = [inG[j], inG[i]];
    const labels = { ...cfg.labels };
    inG.forEach((n, k) => { labels[n] = { ...labels[n], order: (k + 1) * 10 }; });
    setCfg({ ...cfg, labels });
  }
  function addLabel(name: string) {
    const n = name.trim();
    if (!n || cfg.labels[n]) return;
    setCfg({ ...cfg, labels: { ...cfg.labels, [n]: { name: n, color: "#2563EB", group: lastG, order: 1000 } } });
  }
  function removeLabel(name: string) {
    const labels = { ...cfg.labels }; delete labels[name];
    setCfg({ ...cfg, labels });
  }
  async function save() {
    setBusy(true); setMsg("");
    const r = await fetch("/api/labels", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(cfg) }).then((x) => x.json()).catch(() => ({ ok: false, error: "Mất kết nối" }));
    setBusy(false);
    if (r.ok) { setCfg(r.cfg); setMsg("Đã lưu"); } else setMsg(r.error ?? "Không lưu được");
  }
  if (!loaded) return <div className="kv">Đang tải nhãn...</div>;
  return (
    <div className="kc-conn">
      <div className="kv">Nhãn nhân viên gắn cho hội thoại ở thanh nhãn phía trên ô soạn tin. Kết quả chốt hay mất khách xem ở Giai đoạn CRM. Xóa nhãn khỏi danh mục không gỡ nhãn khỏi hội thoại cũ.</div>
      <div className="kc-lbtop">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm nhãn" />
        <input value={newL} placeholder="Nhãn mới" onChange={(e) => setNewL(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { addLabel(newL); setNewL(""); } }} />
        <button type="button" className="btn" disabled={!newL.trim()} onClick={() => { addLabel(newL); setNewL(""); }}>Thêm nhãn</button>
        <button type="button" className="btn p" disabled={busy} onClick={() => void save()}>Lưu</button>
      </div>
      {unknown.length > 0 && (
        <div className="kv">Đang gắn ở hội thoại nhưng chưa có trong danh mục: {unknown.map((n) => <button key={n} type="button" className="kc-mini" style={{ marginRight: 4 }} onClick={() => addLabel(n)}>+ {n} ({used[n]})</button>)}</div>
      )}
      <div className="kc-tw">
        <table className="kc-tb kc-qt">
          <thead><tr><th>Nhãn</th><th style={{ width: 60 }}>Màu</th><th style={{ width: 60 }}>Ẩn</th><th style={{ width: 70 }}>Thứ tự</th><th style={{ width: 70 }}>Đang gắn</th><th style={{ width: 40 }} /></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="kv">{Object.keys(cfg.labels).length ? "Không có nhãn khớp." : "Chưa có nhãn. Gõ tên nhãn rồi bấm Thêm nhãn."}</td></tr>}
            {rows.map((r) => (
              <tr key={r.name} className={cfg.labels[r.name]?.hidden ? "kc-dim" : ""}>
                <td><span className="kc-tag" style={{ background: r.color, color: "#fff" }}>{r.name}</span></td>
                <td><input type="color" value={r.color} aria-label={`Màu nhãn ${r.name}`} onChange={(e) => set(r.name, { color: e.target.value.toUpperCase() })} /></td>
                <td><input type="checkbox" checked={!!r.hidden} aria-label={`Ẩn nhãn ${r.name}`} onChange={(e) => set(r.name, { hidden: e.target.checked })} /></td>
                <td className="kc-qa"><button type="button" onClick={() => move(r.name, -1)} aria-label="Lên">↑</button><button type="button" onClick={() => move(r.name, 1)} aria-label="Xuống">↓</button></td>
                <td className="kv">{used[r.name] ?? 0}</td>
                <td><button type="button" className="kc-link" title="Xóa nhãn khỏi danh mục" onClick={() => removeLabel(r.name)}>Xóa</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg && <div className="kv">{msg}</div>}
    </div>
  );
}
