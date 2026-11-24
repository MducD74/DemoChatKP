"use client";
/* Mục Thư viện mẫu: sao chép từ KP Chat 1 (ChatLibrary.tsx) gồm Mẫu trả lời và Thư mục ảnh, chỉ đổi cách gọi dữ liệu sang API của KP Chat 2.0.
   - Thư mục ảnh: cột thư mục (Tất cả ảnh, Tải lên gần đây, các thư mục có số ảnh), tìm ảnh theo tên, lưới ảnh, kéo thả để thêm, chọn nhiều ảnh để gửi.
   - Mẫu trả lời nhanh: bảng STT, ký tự tắt, tin nhắn (kèm ảnh nhỏ), mỗi mẫu có nhiều nội dung (chữ + ảnh) gửi lần lượt, có biến như {ten_khach}. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MediaItem, QuickBlock, Template } from "@/core/store";
import { Modal, Select } from "./ui";
import { useActor } from "./actor";
import { shrinkImage } from "./ChatParts";

export type LibItem = MediaItem & { url: string };
export interface Lib { folders: string[]; items: LibItem[] }
export const VARS: [string, string][] = [["ten_khach", "Tên khách"], ["ten_nhan_vien", "Tên nhân viên"]];
const MAX_IMG = 10; // số ảnh tối đa mỗi nội dung của mẫu

async function api(url: string, method = "GET", body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  return r.json().catch(() => ({})) as Promise<{ ok?: boolean; error?: string; templates?: Template[] } & Record<string, unknown>>;
}
export const useLibrary = () => {
  const [lib, setLib] = useState<Lib | null>(null);
  const reload = useCallback(async () => setLib((await api("/api/library")) as unknown as Lib), []);
  useEffect(() => { reload(); }, [reload]);
  return { lib, reload };
};
export const preview = (t: Template) => t.blocks.map((b) => b.text).filter(Boolean).join(" · ");

/* bộ biểu tượng nét mảnh, gọn (cùng phong cách với menu KPF) */
const ICON: Record<string, string> = {
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  image: "M4 5h16v14H4zM8.5 10a1.2 1.2 0 1 0 0 .01M20 15l-5-5-9 9",
  plus: "M12 5v14M5 12h14",
  pencil: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  search: "M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM20 20l-4-4",
  upload: "M12 16V4M7 9l5-5 5 5M4 20h16",
  download: "M12 4v12M7 11l5 5 5-5M4 20h16",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  x: "M6 6l12 12M18 6L6 18",
  check: "M5 13l4 4L19 7",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  message: "M21 12a8 8 0 0 1-11.7 7L4 20l1.1-4.4A8 8 0 1 1 21 12z",
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4z",
};
export function Icon({ n, size = 16 }: { n: keyof typeof ICON | string; size?: number }) {
  return <svg className="kc-i2" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON[n] ?? ""} /></svg>;
}

/* hộp hỏi ngay trong giao diện (thay cho prompt/confirm của trình duyệt, vì khung ứng dụng thường chặn các hộp đó): có ô nhập hoặc chỉ xác nhận */
export type Ask = { title: string; message?: string; input?: boolean; initial?: string; okText?: string; danger?: boolean; run: (v: string) => Promise<void> | void };
export function AskModal({ ask, onClose }: { ask: Ask; onClose: () => void }) {
  const [v, setV] = useState(ask.initial ?? "");
  const [busy, setBusy] = useState(false);
  const go = async () => { if (ask.input && !v.trim()) return; setBusy(true); await ask.run(v.trim()); setBusy(false); onClose(); };
  return (
    <Modal title={ask.title} onClose={onClose} small footer={<><button className="btn" onClick={onClose}>Hủy</button><button className={`btn ${ask.danger ? "bad" : "p"}`} disabled={busy || (!!ask.input && !v.trim())} onClick={() => void go()}>{ask.okText ?? "Đồng ý"}</button></>}>
      <div className="kc-conn" style={{ minWidth: 0 }}>
        {ask.message && <div>{ask.message}</div>}
        {ask.input && <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void go(); }} />}
      </div>
    </Modal>
  );
}

type Folder = "all" | "recent" | string;

/* Trình duyệt ảnh. pick có thì ở chế độ chọn ảnh để gửi (không sửa được); không có thì chế độ quản lý (quản trị thêm, sửa, xóa). */
export function MediaBrowser({ lib, reload, admin: isAdmin, pick, height = 520 }: { lib: Lib; reload: () => Promise<void>; admin: boolean; pick?: { max: number; initial: string[]; label: string; onDone: (ids: string[]) => void; onLocal?: (f: FileList, sel: string[]) => void; onSendNow?: (ids: string[]) => void }; height?: number | string }) {
  const admin = isAdmin && !pick;
  const [folder, setFolder] = useState<Folder>("all");
  const [q, setQ] = useState("");
  const [qf, setQf] = useState("");
  const [sel, setSel] = useState<string[]>(pick?.initial ?? []);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const localRef = useRef<HTMLInputElement>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const count = (g: string) => lib.items.filter((x) => x.folder === g).length;
  const folders = lib.folders.filter((g) => !qf || g.toLowerCase().includes(qf.toLowerCase()));
  const items = useMemo(() => {
    const k = q.trim().toLowerCase();
    let list = lib.items;
    if (k) list = list.filter((x) => x.name.toLowerCase().includes(k));
    else if (folder === "recent") list = [...lib.items].sort((a, b) => b.at - a.at).slice(0, 40);
    else if (folder !== "all") list = lib.items.filter((x) => x.folder === folder);
    return list;
  }, [lib.items, folder, q]);
  const target = lib.folders.includes(folder) ? folder : lib.folders[0] ?? ""; // như KP Chat 1: đang ở thư mục nào thì tải vào đó, ở Tất cả ảnh thì vào thư mục đầu tiên; chưa có thư mục nào thì để chưa phân

  async function upload(files: FileList | File[] | null) {
    const arr = files ? Array.from(files).filter((f) => f.type.startsWith("image/")) : [];
    if (!arr.length) return;
    setBusy(true); let ok = 0; let err = "";
    for (const f0 of arr.slice(0, 30)) {
      const f = await shrinkImage(f0);
      const fd = new FormData(); fd.append("file", f, f0.name); if (target) fd.append("folder", target);
      const r = await fetch("/api/library", { method: "POST", body: fd }).then((x) => x.json() as Promise<{ ok?: boolean; error?: string }>).catch((): { ok?: boolean; error?: string } => ({ error: "Lỗi mạng" }));
      if (r.ok) ok++; else err = r.error ?? "Lỗi";
    }
    setBusy(false); setMsg(`Đã thêm ${ok} ảnh${err ? `, lỗi: ${err}` : ""}`); await reload();
  }
  async function act(p: Promise<{ ok?: boolean; error?: string }>) { const r = await p; if (!r.ok) setMsg(r.error ?? "Lỗi"); else await reload(); return !!r.ok; }
  const addFolder = () => setAsk({ title: "Thư mục mới", input: true, initial: "", okText: "Tạo thư mục", run: async (n) => { await act(api("/api/library/folders", "POST", { name: n })); } });
  const renameFolder = (name: string) => setAsk({ title: "Đổi tên thư mục", input: true, initial: name, okText: "Lưu", run: async (n) => { if (await act(api("/api/library/folders", "PATCH", { from: name, to: n })) && folder === name) setFolder(n); } });
  const removeFolder = (name: string) => setAsk({ title: `Xóa thư mục "${name}"?`, message: "Ảnh trong thư mục được giữ lại ở mục Tất cả ảnh.", okText: "Xóa", danger: true, run: async () => { if (await act(api(`/api/library/folders?name=${encodeURIComponent(name)}`, "DELETE"))) setFolder("all"); } });
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : pick && s.length >= pick.max ? s : [...s, id]));

  return (
    <div className="kc-lb" style={{ height }}>
      <aside className="kc-lbs">
        <div className="kc-lbsearch"><input value={qf} onChange={(e) => setQf(e.target.value)} placeholder="Tìm thư mục" />{admin && <button title="Thêm thư mục" onClick={addFolder}><Icon n="plus" size={16} /></button>}</div>
        <button className={`kc-fo${folder === "all" && !q ? " on" : ""}`} onClick={() => { setFolder("all"); setQ(""); }}><Icon n="grid" /> Tất cả ảnh <em>{lib.items.length}</em></button>
        <button className={`kc-fo${folder === "recent" && !q ? " on" : ""}`} onClick={() => { setFolder("recent"); setQ(""); }}><Icon n="clock" /> Tải lên gần đây</button>
        <div className="kc-fol">
          {folders.map((g) => (
            <div key={g} className={`kc-fo2${folder === g && !q ? " on" : ""}`}>
              <button onClick={() => { setFolder(g); setQ(""); }}><Icon n="folder" /> {g} <em>{count(g)}</em></button>
              {admin && <span><button title="Đổi tên" onClick={() => renameFolder(g)}><Icon n="pencil" size={13} /></button><button title="Xóa thư mục" onClick={() => removeFolder(g)}><Icon n="x" size={13} /></button></span>}
            </div>
          ))}
          {lib.folders.length === 0 && <div className="kv" style={{ padding: 8 }}>Chưa có thư mục.{admin ? " Bấm ＋ để tạo." : ""}</div>}
        </div>
      </aside>
      <section className="kc-lbm" onDragOver={(e) => { if (isAdmin) { e.preventDefault(); setDrag(true); } }} onDragLeave={() => setDrag(false)} onDrop={(e) => { if (isAdmin) { e.preventDefault(); setDrag(false); void upload(e.dataTransfer.files); } }}>
        <div className="kc-lbtop">
          <div className="kc-sbox"><Icon n="search" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm ảnh bằng tên" /></div>
          {pick?.onLocal && <><button className="btn p" onClick={() => localRef.current?.click()}><Icon n="upload" /> Tải ảnh từ máy</button><input ref={localRef} type="file" multiple hidden accept="image/jpeg,image/png,image/webp" onChange={(e) => { if (e.target.files?.length) pick.onLocal?.(e.target.files, sel); e.target.value = ""; }} /></>}
          {isAdmin && <><button className={`btn${pick ? "" : " p"}`} disabled={busy} onClick={() => fileRef.current?.click()}><Icon n="upload" /> {busy ? "Đang tải..." : `Tải ảnh lên${target ? ` · ${target}` : ""}`}</button><input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} /></>}
        </div>
        <div className={`kc-lbgrid${drag ? " drag" : ""}`}>
          {items.length === 0 && <div className="kc-dz"><Icon n={q ? "search" : "image"} size={40} /><b>{q ? "Không có ảnh nào khớp" : isAdmin ? "Kéo thả ảnh vào đây hoặc bấm Tải ảnh lên" : "Chưa có ảnh trong thư viện"}</b>{!q && isAdmin && <span>JPEG, PNG, WebP · tự thu nhỏ khi tải lên</span>}</div>}
          {items.map((it) => (
            <div key={it.id} className={`kc-lt-i${sel.includes(it.id) ? " on" : ""}`}>
              <button type="button" className="kc-lt-b" onClick={() => (pick ? toggle(it.id) : undefined)} aria-label={it.name}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={it.url} alt={it.name} loading="lazy" />
              </button>
              <span title={it.name}>{it.name}</span>
              {sel.includes(it.id) && <i className="kc-ck"><Icon n="check" size={13} /></i>}
              {admin && (
                <div className="kc-lt-a">
                  <button title="Đổi tên" onClick={() => setAsk({ title: "Đổi tên ảnh", input: true, initial: it.name, okText: "Lưu", run: async (n) => { await act(api(`/api/library/${it.id}`, "PATCH", { name: n })); } })}><Icon n="pencil" size={15} /></button>
                  <select title="Chuyển thư mục" value={it.folder ?? ""} onChange={(e) => void act(api(`/api/library/${it.id}`, "PATCH", { folder: e.target.value || null }))}><option value="">Chưa phân thư mục</option>{lib.folders.map((g) => <option key={g} value={g}>{g}</option>)}</select>
                  <button title="Xóa ảnh" onClick={() => setAsk({ title: `Xóa ảnh "${it.name}"?`, message: "Ảnh bị xóa khỏi thư viện và các mẫu đang dùng nó sẽ mất ảnh này.", okText: "Xóa", danger: true, run: async () => { await act(api(`/api/library/${it.id}`, "DELETE")); } })}><Icon n="trash" size={15} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="kc-lbfoot">
          <span className="kv">{msg || (pick ? (sel.length ? `Đã chọn ${sel.length}/${pick.max} ảnh` : `Bấm ảnh để chọn (tối đa ${pick.max})`) : `${items.length} ảnh`)}</span>
          {pick?.onSendNow && <button className="btn" disabled={!sel.length} onClick={() => pick.onSendNow?.(sel)}><Icon n="send" /> Gửi ngay{sel.length ? ` (${sel.length})` : ""}</button>}
          {pick && <button className="btn p" disabled={!sel.length} onClick={() => pick.onDone(sel)}>{pick.label}{sel.length ? ` (${sel.length})` : ""}</button>}
        </div>
      </section>
      {ask && <AskModal ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}

/* hộp chọn ảnh (dùng ở khung soạn tin và khi sửa mẫu) */
export function MediaPickModal({ lib, reload, max, initial, label, onDone, onClose, onLocal, onSendNow }: { lib: Lib | null; reload: () => Promise<void>; max: number; initial: string[]; label: string; onDone: (ids: string[]) => void; onClose: () => void; onLocal?: (f: FileList, sel: string[]) => void; onSendNow?: (ids: string[]) => void }) {
  const admin = useActor().me.role === "admin";
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);
  return (
    <Modal title="Thư mục ảnh" onClose={onClose} wide>
      {!lib ? <div className="kv" style={{ padding: 16 }}>Đang tải thư viện...</div> : <MediaBrowser lib={lib} reload={reload} admin={admin} height="min(72vh, 640px)" pick={{ max, initial, label, onDone, onLocal, onSendNow }} />}
    </Modal>
  );
}

/* ---------------- Mẫu trả lời nhanh ---------------- */
export function QuickLibrary({ quick, lib, admin, reload, reloadLib }: { quick: Template[]; lib: Lib | null; admin: boolean; reload: () => Promise<void>; reloadLib: () => Promise<void> }) {
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<{ index: number } | null>(null);
  const [msg, setMsg] = useState("");
  const [ask, setAsk] = useState<Ask | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgUrl = (id: string): string => lib?.items.find((x) => x.id === id)?.url ?? "";
  const list = quick.map((x, i) => ({ x, i })).filter(({ x }) => !q || `${x.key} ${preview(x)}`.toLowerCase().includes(q.toLowerCase()));
  async function saveOne(id: string | undefined, key: string, blocks: QuickBlock[]): Promise<boolean> {
    const r = await api("/api/templates", "POST", { id, key, blocks });
    setMsg(r.ok ? "Đã lưu" : r.error ?? "Lỗi"); if (r.ok) await reload(); return !!r.ok;
  }
  async function move(t: Template, dir: number) { await api("/api/templates/move", "POST", { id: t.id, dir }); await reload(); }
  function exportJson() {
    const data = JSON.stringify(quick.map((x) => ({ key: x.key, blocks: x.blocks.map((b) => ({ text: b.text })) })), null, 2);
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data], { type: "application/json" })); a.download = "mau-tra-loi-nhanh.json"; a.click(); URL.revokeObjectURL(a.href);
  }
  async function importJson(f: File | undefined) {
    if (!f) return;
    try {
      const arr = JSON.parse(await f.text()) as { key?: string; blocks?: { text?: string }[]; text?: string }[];
      const have = new Set(quick.map((x) => x.key.toLowerCase()));
      const add = arr.filter((x) => x.key && !have.has(String(x.key).toLowerCase())).map((x) => ({ key: String(x.key), blocks: (x.blocks?.length ? x.blocks : [{ text: x.text ?? "" }]).map((b) => ({ text: String(b.text ?? ""), images: [] as string[] })) }));
      if (!add.length) { setMsg("Không có mẫu mới để nhập (trùng ký tự tắt hoặc tệp rỗng)."); return; }
      let ok = 0, err = "";
      for (const t of add) { const r = await api("/api/templates", "POST", t); if (r.ok) ok++; else err = r.error ?? "Lỗi"; }
      setMsg(`Đã nhập ${ok}/${add.length} mẫu${err ? `, lỗi: ${err}` : ""}`); await reload();
    } catch { setMsg("Tệp không đúng định dạng JSON."); }
  }
  return (
    <div className="kc-ql">
      <div className="kc-lbtop">
        <div className="kc-sbox"><Icon n="search" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo ký tự tắt hoặc nội dung" /></div>
        {admin && <>
          <button className="btn" title="Xuất mẫu ra tệp" onClick={exportJson}><Icon n="download" /> Xuất</button>
          <button className="btn" title="Nhập mẫu từ tệp JSON" onClick={() => fileRef.current?.click()}><Icon n="upload" /> Nhập</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => { void importJson(e.target.files?.[0]); e.target.value = ""; }} />
          <button className="btn p" onClick={() => setEdit({ index: -1 })}><Icon n="plus" /> Thêm mẫu</button>
        </>}
      </div>
      <div className="kc-tw"><table className="kc-tb kc-qt"><thead><tr><th style={{ width: 46 }}>STT</th><th style={{ width: 130 }}>Ký tự tắt</th><th>Tin nhắn</th>{admin && <th style={{ width: 150 }} />}</tr></thead>
        <tbody>
          {list.length === 0 && <tr><td colSpan={4} className="kv">{quick.length ? "Không có mẫu nào khớp." : "Chưa có mẫu. Bấm Thêm mẫu."}</td></tr>}
          {list.map(({ x, i }) => {
            const ids = x.blocks.flatMap((b) => b.images);
            return (
              <tr key={x.id}>
                <td>{i + 1}</td><td><b>/{x.key}</b></td>
                <td><div className="kc-qp">{ids.length > 0 && <span className="kc-qimgs">{ids.slice(0, 1).map((id) => imgUrl(id) && /* eslint-disable-next-line @next/next/no-img-element */ <img key={id} src={imgUrl(id)} alt="" />)}{ids.length > 1 && <em>+{ids.length - 1}</em>}</span>}<span className="kc-qtxt">{preview(x) || "(chỉ có ảnh)"}</span>{x.blocks.length > 1 && <em className="kc-qn">{x.blocks.length} nội dung</em>}</div></td>
                {admin && <td className="kc-qa"><button title="Lên" onClick={() => void move(x, -1)}><Icon n="up" size={14} /></button><button title="Xuống" onClick={() => void move(x, 1)}><Icon n="down" size={14} /></button><button title="Sửa mẫu" onClick={() => setEdit({ index: i })}><Icon n="pencil" size={14} /></button><button title="Xóa mẫu" onClick={() => setAsk({ title: `Xóa mẫu /${x.key}?`, okText: "Xóa", danger: true, run: async () => { await api(`/api/templates?id=${encodeURIComponent(x.id)}`, "DELETE"); await reload(); } })}><Icon n="trash" size={14} /></button></td>}
              </tr>
            );
          })}
        </tbody></table></div>
      <div className="kv">{msg || `Gõ "/" + ký tự tắt trong ô soạn tin để chèn mẫu. Biến: ${VARS.map(([k]) => `{${k}}`).join(" ")}.`}</div>
      {ask && <AskModal ask={ask} onClose={() => setAsk(null)} />}
      {edit && <QuickModal init={edit.index >= 0 ? quick[edit.index] : null} lib={lib} reloadLib={reloadLib} onClose={() => setEdit(null)}
        onSave={async (key, blocks) => { const ok = await saveOne(edit.index >= 0 ? quick[edit.index].id : undefined, key, blocks); if (ok) setEdit(null); return ok; }} />}
    </div>
  );
}

function QuickModal({ init, lib, reloadLib, onClose, onSave }: { init: Template | null; lib: Lib | null; reloadLib: () => Promise<void>; onClose: () => void; onSave: (key: string, blocks: QuickBlock[]) => Promise<boolean> }) {
  const [key, setKey] = useState(init?.key ?? "");
  const [blocks, setBlocks] = useState<QuickBlock[]>(init?.blocks.length ? init.blocks.map((b) => ({ ...b, images: [...b.images] })) : [{ text: "", images: [] }]);
  const [pickFor, setPickFor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const url = (id: string): string => lib?.items.find((x) => x.id === id)?.url ?? "";
  const setB = (i: number, p: Partial<QuickBlock>) => setBlocks(blocks.map((b, j) => (j === i ? { ...b, ...p } : b)));
  return (
    <>
      <Modal title={init ? `Sửa mẫu /${init.key}` : "Thêm mẫu trả lời nhanh"} onClose={onClose} wide footer={<><button className="btn" onClick={onClose}>Hủy</button><button className="btn p" disabled={busy} onClick={() => { setBusy(true); void onSave(key, blocks).then(() => setBusy(false)); }}>Lưu</button></>}>
        <div className="kc-conn">
          <label className="kc-f"><span>Ký tự tắt</span><div className="kc-slash"><b>/</b><input value={key} onChange={(e) => setKey(e.target.value.replace(/\s/g, ""))} placeholder="ví dụ: menu, gia, chot" /></div></label>
          {blocks.map((b, i) => (
            <div key={i} className="kc-blk">
              <div className="kc-blkh"><b>Nội dung {i + 1}</b>{blocks.length > 1 && <button className="kc-x2" title="Xóa nội dung này" onClick={() => setBlocks(blocks.filter((_, j) => j !== i))}><Icon n="x" size={16} /></button>}</div>
              <textarea rows={3} value={b.text} onChange={(e) => setB(i, { text: e.target.value })} placeholder="Nội dung tin nhắn" />
              {b.images.length > 0 && <div className="kc-chipsimg">{b.images.map((id) => <span key={id} className="kc-ci">{/* eslint-disable-next-line @next/next/no-img-element */}{url(id) ? <img src={url(id)} alt="" /> : <i>?</i>}<button title="Bỏ ảnh" onClick={() => setB(i, { images: b.images.filter((x) => x !== id) })}>×</button></span>)}</div>}
              <div className="kc-blkt">
                <button className="btn" onClick={() => setPickFor(i)}><Icon n="image" /> Ảnh{b.images.length ? ` (${b.images.length})` : ""}</button>
                <Select value="" onChange={(v) => v && setB(i, { text: `${b.text}${b.text && !/\s$/.test(b.text) ? " " : ""}{${v}}` })} options={[["", "{ } Chèn biến"], ...VARS.map(([k, n]): [string, string] => [k, `${n}  {${k}}`])]} />
              </div>
            </div>
          ))}
          {blocks.length < 6 && <button className="kc-add" onClick={() => setBlocks([...blocks, { text: "", images: [] }])}><Icon n="plus" /> Thêm nội dung (gửi lần lượt)</button>}
          <div className="kv">Mỗi nội dung là một tin gửi đi theo thứ tự. Một nội dung có thể có chữ và tối đa {MAX_IMG} ảnh.</div>
        </div>
      </Modal>
      {pickFor !== null && <MediaPickModal lib={lib} reload={reloadLib} max={MAX_IMG} initial={blocks[pickFor]?.images ?? []} label="Chọn ảnh" onClose={() => setPickFor(null)} onDone={(ids) => { setB(pickFor, { images: ids }); setPickFor(null); }} />}
    </>
  );
}

/* tab Thư viện mẫu */
export default function LibraryPane() {
  const admin = useActor().me.role === "admin";
  const { lib, reload } = useLibrary();
  const [sub, setSub] = useState<"quick" | "media">("quick");
  const [list, setList] = useState<Template[]>([]);
  const loadT = useCallback(async () => setList((await api("/api/templates")).templates ?? []), []);
  useEffect(() => { loadT(); }, [loadT]);
  return (
    <div className="kc-libpage">
      <div className="kc-libhead">
        <div className="kc-mt"><button className={sub === "quick" ? "on" : ""} onClick={() => setSub("quick")}><Icon n="message" /> Mẫu trả lời{list.length ? ` (${list.length})` : ""}</button><button className={sub === "media" ? "on" : ""} onClick={() => setSub("media")}><Icon n="image" /> Thư mục ảnh{lib ? ` (${lib.items.length})` : ""}</button></div>
        <span className="kv">{sub === "quick" ? "Gõ / cùng ký tự tắt trong ô soạn tin để chèn mẫu." : "Chọn ảnh ở nút Ảnh cạnh ô soạn tin để gửi khách."}{!admin && " Chỉ quản trị mới thêm, sửa, xóa."}</span>
      </div>
      <div className="kc-libfull">
        {sub === "quick" && <QuickLibrary quick={list} lib={lib} admin={admin} reload={loadT} reloadLib={reload} />}
        {sub === "media" && (!lib ? <div className="kv">Đang tải...</div> : <MediaBrowser lib={lib} reload={reload} admin={admin} height="100%" />)}
      </div>
    </div>
  );
}
