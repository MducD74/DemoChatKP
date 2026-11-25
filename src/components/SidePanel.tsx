"use client";
/* Cột hồ sơ bên phải hộp thư, bố cục theo KP Chat 1: tên khách và nút Sửa, các dòng (SĐT, phụ trách, lead CRM, việc tiếp, KiotViet),
   rồi bốn tab Ghi chú, Nhiệm vụ, Lịch sử, Đơn hàng. Lead, nhiệm vụ, đơn hàng đến từ KP CRM, KP Tasks và POS khi nối KPF (xem core/hostprofile.ts);
   bản chạy riêng chưa nối thì hiện số liệu giữ trong KP Chat và báo rõ phần nào chưa nối. KP Chat 1 chỉ liệt kê lịch sử đơn hàng, không tạo đơn. */
import { useState } from "react";
import type { Contact, Conversation, Message, TaskPriority } from "@/core/types";
import type { HostProfile } from "@/core/hostprofile";
import { LOST_REASONS, PRIORITY, STAGES } from "@/core/convmeta";
import { Ic, Modal, Select } from "./ui";
import { staffLabel } from "./actor";
import type { BotAssignLite, BotStatusLite } from "./BotMenu";
import { BOT_STATE_LABEL, statusToState } from "@/core/botfilter";
import type { Actor } from "@/core/staff";

async function call(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  return (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
}
const dm = (t: number) => new Date(t).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const dmy = (d: string) => d.split("-").reverse().join("/");

type Tab = "note" | "task" | "his" | "buy";

// Các lựa chọn của ô KP AIbot, không lặp tên: dòng đầu là chọn tự động theo giai đoạn (chỉ ghi tên chatbot khi kênh có một chatbot, còn nhiều thì ghi "Tự động: tên"),
// các chatbot khác để chọn tay (chatbot đang được chọn tự động không lặp lại), cuối cùng là Không dùng chatbot.
export function botOptions(a: BotAssignLite): [string, string][] {
  const auto = a.auto ?? a.picked;
  const first = a.options.length < 2 ? (auto?.name ?? "Tự động") : `Tự động${auto ? `: ${auto.name}` : ""}`;
  const rest = a.options.filter((o) => o.id !== auto?.id || a.sel === o.id).map((o): [string, string] => [o.id, `${o.name}${o.mode === "off" ? " (tắt)" : ""}`]);
  return [["", first], ...rest, ["none", "Không dùng chatbot"]];
}

// Tab Đơn hàng: chỉ liệt kê lịch sử đơn của khách từ POS (như KP Chat 1)
export function BuysTab({ profile }: { profile: HostProfile }) {
  if (!profile.linked.pos) return <div className="kv">Chưa nối POS nên chưa có lịch sử đơn hàng. Khi KP Chat nối vào KPF, các hóa đơn của khách sẽ hiện ở đây.</div>;
  if (!profile.kov) return <div className="kv">Chưa khớp khách KiotViet theo số điện thoại.</div>;
  const b = profile.buys;
  if (!b || b.invoices.length === 0) return <div className="kv">Chưa có đơn hàng.</div>;
  const total = b.invoices.reduce((a, x) => a + x.total, 0);
  return (
    <>
      <div className="kv">{b.invoices.length >= 15 ? "15 hóa đơn gần nhất" : `${b.invoices.length} hóa đơn`} · tổng {total.toLocaleString("vi-VN")}đ</div>
      <table className="kc-tb sm"><tbody>{b.invoices.map((v) => <tr key={v.code}><td>{v.at.slice(5).split("-").reverse().join("/")}</td><td className="kv">{v.code}</td><td>{v.total.toLocaleString("vi-VN")}</td></tr>)}</tbody></table>
      {b.mix.length > 0 && <div className="kv">Hay mua: {b.mix.map((m) => `${m.name} ${m.pct}%`).join(" · ")}</div>}
    </>
  );
}

export default function SidePanel(p: {
  conv: Conversation; contact: Contact; messages: Message[]; profile: HostProfile; kind: string; channelName: string;
  me: { uid: string }; staff: Actor[]; admin: boolean; canAct: boolean; avatar: React.ReactNode;
  botAssign?: BotAssignLite | null; botStatus?: BotStatusLite; onBotAssign?: (bot: string, withStaff: boolean) => void;
  onPatch: (body: object) => Promise<void> | void; onNewOrder?: () => void; // nút + Đơn hàng: chỗ nối tạo đơn khi KP Chat nối vào KPF (POS/KiotViet), chưa làm gì
  onChanged: () => void;
}) {
  const { conv, contact, messages, canAct, staff, profile } = p;
  const [tab, setTab] = useState<Tab>("note");
  const [lost, setLost] = useState<string | null>(null); // đang chọn lý do trước khi chuyển lead sang Mất/Spam
  const [edit, setEdit] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const notes = messages.filter((m) => m.internal);
  const tasks = [...(conv.tasks ?? [])].sort((a, b) => Number(!!a.done) - Number(!!b.done) || (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  const openTasks = tasks.filter((t) => !t.done);
  const log = [...(conv.log ?? [])].reverse();
  const base = `/api/inbox/${encodeURIComponent(conv.id)}`;
  const lead = profile.lead;

  async function run(fn: () => Promise<{ ok?: boolean; error?: string }>, after?: () => void) {
    if (busy) return false;
    setBusy(true); setErr("");
    const r = await fn();
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? "Không thực hiện được"); return false; }
    after?.();
    p.onChanged();
    return true;
  }
  const tabs: [Tab, string][] = [["note", `Ghi chú${notes.length ? ` (${notes.length})` : ""}`], ["task", `Nhiệm vụ${openTasks.length ? ` (${openTasks.length})` : ""}`], ["his", "Lịch sử"], ["buy", "Đơn hàng"]];

  return (
    <div className="kc-scroll pad">
      <div className="kc-ph">
        {p.avatar}
        <div className="kc-phn"><b>{contact.name}</b><span className="kv">{p.kind} · {p.channelName}</span></div>
        {canAct && <button type="button" className="kc-mini" title="Lấy lại tên và ảnh khách từ kênh" disabled={busy} onClick={() => void run(() => call(`${base}/profile`, "POST"))}>↻ Ảnh</button>}
        {canAct && <button type="button" className="kc-mini" title="Sửa thông tin khách" onClick={() => setEdit(true)}>✎ Sửa</button>}
      </div>
      <div className="kc-lines">
        <div><span>SĐT</span><b className={contact.phone ? "" : "kv"}>{contact.phone || "Chưa có"}</b></div>
        {(contact.address || contact.area) && <div><span>Địa chỉ</span><b>{[contact.address, contact.area].filter(Boolean).join(", ")}</b></div>}
        <div><span>Phụ trách</span><b>{conv.assigneeUid ? staffLabel(staff, conv.assigneeUid) : "Chưa nhận"}</b></div>
        {/* KP AIbot cùng phụ trách với nhân viên: gán chatbot cho hội thoại và xem chatbot đang làm gì */}
        <div><span>KP AIbot</span>
          {p.botAssign
            ? <Select value={p.botAssign.sel} disabled={!canAct} options={botOptions(p.botAssign)} onChange={(v) => p.onBotAssign?.(v, p.botAssign?.withStaff ?? false)} />
            : <b className="kv">Chưa có ở kênh này</b>}
        </div>
        {p.botAssign && conv.assigneeUid && p.botAssign.sel !== "none" && (
          <label className="kc-bwith" title="Nhân viên vừa trả lời thì chatbot vẫn tạm dừng một giờ"><input type="checkbox" checked={p.botAssign.withStaff} disabled={!canAct} onChange={(e) => p.onBotAssign?.(p.botAssign?.sel ?? "", e.target.checked)} /> Cùng trả lời với nhân viên</label>
        )}
        {p.botStatus && p.botStatus.kind !== "none" && (
          <>
            <div><span>Trạng thái</span><b className={`kc-bst ${p.botStatus.kind}`} title={p.botStatus.text}><i aria-hidden="true" />{BOT_STATE_LABEL[statusToState(p.botStatus.kind)]}</b></div>
          </>
        )}
        {lead
          ? <div><span>Lead CRM</span><Select value={lost !== null ? "lost" : lead.stage} disabled={!canAct} options={[...STAGES.map((x): [string, string] => [x.key, x.name]), ["", "Bỏ lead"]]} onChange={(v) => { if (v === "lost") { setLost(""); return; } setLost(null); void p.onPatch({ stage: v || null }); }} />{lead.href && <a href={lead.href}>Mở ›</a>}</div>
          : canAct && <div><span>Lead CRM</span><b className="kv">Chưa có</b><button type="button" className="kc-mini" onClick={() => void p.onPatch({ stage: "new" })}>+ Tạo lead</button></div>}
        {lost !== null && (
          <div className="kc-lostb">
            <b>Chuyển lead sang &quot;Mất/Spam&quot;. Lý do:</b>
            <Select value={lost} onChange={setLost} options={[["", "Chọn lý do mất đơn..."], ...LOST_REASONS.map((x): [string, string] => [x, x])]} />
            <div><button type="button" className="btn cta" disabled={!lost} onClick={async () => { await p.onPatch({ stage: "lost", lostReason: lost }); setLost(null); }}>Xác nhận</button> <button type="button" className="btn" onClick={() => setLost(null)}>Hủy</button></div>
          </div>
        )}
        {lost === null && conv.lostReason && <div><span>Lý do mất</span><b>{conv.lostReason}</b></div>}
        <div><span>Đơn hàng</span><b className="kv">{profile.linked.pos ? "Xem ở tab Đơn hàng" : "Chưa nối POS"}</b>{canAct && <button type="button" className="kc-mini" title="Tạo đơn sẽ có khi KP Chat nối vào KPF (POS)" onClick={() => p.onNewOrder?.()}>+ Đơn hàng</button>}</div>
        {lead?.nextAction && <div><span>Việc tiếp</span><b>{lead.nextAction}{lead.nextDue ? ` · ${dmy(lead.nextDue)}` : ""}</b></div>}
        {profile.custStatus && <div><span>Chăm sóc KH</span><b>{profile.custStatus}</b></div>}
        {profile.kov && <div><span>KiotViet</span><b>{profile.kov.code} · {profile.kov.name}</b>{profile.kov.href && <a href={profile.kov.href}>Mở ›</a>}</div>}
        {!profile.linked.crm && <div className="kv">Chưa nối KP CRM, KP Tasks và POS: lead và nhiệm vụ đang lưu trong KP Chat.</div>}
      </div>
      <div className="kc-st" role="tablist">
        {tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {err && <div className="kc-err">{err}</div>}

      {tab === "note" && (
        <div className="kc-tabbody">
          {canAct && <div className="kc-nbox"><textarea rows={1} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú nội bộ (khách không thấy)" /><button type="button" className="btn" disabled={busy || !note.trim()} onClick={() => run(() => call(`${base}/note`, "POST", { text: note }), () => setNote(""))}>Lưu</button></div>}
          {notes.length === 0 && <div className="kv">Chưa có ghi chú.</div>}
          {[...notes].reverse().map((m) => <div key={m.id} className="kc-card"><div>{m.text}</div><div className="kv">{m.bot ? "Chatbot" : staffLabel(staff, m.senderUid)} · {dm(m.at)}</div></div>)}
        </div>
      )}

      {tab === "task" && (
        <div className="kc-tabbody">
          {canAct && <button type="button" className="kc-add" onClick={() => setTaskOpen(true)}><Ic n="plus" /> Nhiệm vụ</button>}
          {tasks.length === 0 && <div className="kv">Chưa có nhiệm vụ cho khách này.</div>}
          {tasks.map((t) => (
            <div key={t.id} className={`kc-tk2${t.done ? " done" : ""}`}>
              <input type="checkbox" checked={!!t.done} disabled={!canAct} aria-label="Đã xong" onChange={(e) => run(() => call(`${base}/task`, "PATCH", { taskId: t.id, done: e.target.checked }))} />
              <span className="kc-tk2t">
                <b>{t.text}</b>
                <em className={!t.done && t.due && t.due < today() ? "late" : ""}>{[t.due ? `hạn ${dmy(t.due)}${t.time ? ` ${t.time}` : ""}` : "", t.priority ? PRIORITY.find(([k]) => k === t.priority)?.[1] : "", t.owner ? staffLabel(staff, t.owner) : ""].filter(Boolean).join(" · ")}</em>
                {t.note && <em>{t.note}</em>}
              </span>
              {canAct && <button type="button" className="kc-tk2x" title="Xóa nhiệm vụ" aria-label="Xóa nhiệm vụ" onClick={() => run(() => call(`${base}/task`, "DELETE", { taskId: t.id }))}>×</button>}
            </div>
          ))}
        </div>
      )}

      {tab === "his" && (
        <div className="kc-tabbody">
          {log.length === 0 && <div className="kv">Chưa có lịch sử thao tác.</div>}
          {log.map((h, i) => <div key={i} className="kc-hi"><span>{dm(h.at)}{h.by ? ` · ${staffLabel(staff, h.by)}` : ""}</span><div>{h.text}</div></div>)}
        </div>
      )}

      {tab === "buy" && <div className="kc-tabbody"><BuysTab profile={profile} /></div>}

      {taskOpen && <TaskModal staff={staff} meId={p.me.uid} customer={contact.name} onClose={() => setTaskOpen(false)} onSave={async (v) => { const ok = await run(() => call(`${base}/task`, "POST", v)); if (ok) setTaskOpen(false); }} />}
      {edit && <InfoEditor contact={contact} onClose={() => setEdit(false)} onSave={async (v) => { const r = await call(`${base}/info`, "PUT", v); if (r.ok) { setEdit(false); p.onChanged(); return ""; } return r.error ?? "Không lưu được"; }} />}
    </div>
  );
}

// Tạo nhiệm vụ cho khách: các trường như hộp Nhiệm vụ của KP Chat 1 (tên, ưu tiên, ngày và giờ hạn, người thực hiện, ghi chú)
function TaskModal({ staff, meId, customer, onClose, onSave }: { staff: Actor[]; meId: string; customer: string; onClose: () => void; onSave: (v: { text: string; priority: TaskPriority; due: string; time: string; owner: string; note: string }) => Promise<void> }) {
  const [f, setF] = useState({ text: "", priority: "med" as TaskPriority, due: "", time: "", owner: meId, note: "" });
  const [busy, setBusy] = useState(false);
  const ok = !!f.text.trim() && !!f.due;
  return (
    <Modal title={<>Nhiệm vụ <span className="kc-gchip">{customer}</span></>} onClose={onClose} footer={<><button type="button" className="btn" onClick={onClose}>Hủy</button><button type="button" className="btn p" disabled={!ok || busy} onClick={() => { setBusy(true); void onSave(f).then(() => setBusy(false)); }}>Tạo nhiệm vụ</button></>}>
      <div className="kc-conn">
        <label className="kc-f"><span>Tên nhiệm vụ <b style={{ color: "#DC2626" }}>*</b></span><input value={f.text} maxLength={200} autoFocus onChange={(e) => setF({ ...f, text: e.target.value })} placeholder="Ví dụ: Gọi báo giá hộp quà" /></label>
        <div className="kc-fg">
          <label className="kc-f"><span>Ưu tiên</span><Select value={f.priority} onChange={(v) => setF({ ...f, priority: v as TaskPriority })} options={PRIORITY} /></label>
          <label className="kc-f"><span>Người thực hiện</span><Select value={f.owner} onChange={(v) => setF({ ...f, owner: v })} options={staff.map((s): [string, string] => [s.uid, s.name])} /></label>
          <label className="kc-f"><span>Ngày đến hạn <b style={{ color: "#DC2626" }}>*</b></span><input type="date" value={f.due} min={today()} onChange={(e) => setF({ ...f, due: e.target.value })} /></label>
          <label className="kc-f"><span>Giờ</span><input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></label>
        </div>
        <label className="kc-f"><span>Ghi chú</span><textarea rows={3} maxLength={200} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Nhập ghi chú" /></label>
      </div>
    </Modal>
  );
}

function InfoEditor({ contact, onClose, onSave }: { contact: Contact; onClose: () => void; onSave: (v: { phone: string; address: string; area: string }) => Promise<string> }) {
  const [f, setF] = useState({ phone: contact.phone ?? "", address: contact.address ?? "", area: contact.area ?? "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const save = () => { setBusy(true); setErr(""); void onSave(f).then((e) => { setBusy(false); if (e) setErr(e); }); };
  return (
    <Modal title="Thông tin khách" small onClose={onClose} footer={<><button type="button" className="btn" onClick={onClose}>Hủy</button><button type="button" className="btn p" disabled={busy} onClick={save}>Lưu</button></>}>
      <div className="kc-conn">
        <label className="kc-f"><span>Số điện thoại</span><input value={f.phone} inputMode="tel" onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="0905 123 456" autoFocus /></label>
        <label className="kc-f"><span>Địa chỉ</span><input value={f.address} maxLength={200} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="Số nhà, đường" /></label>
        <label className="kc-f"><span>Phường / khu vực</span><input value={f.area} maxLength={80} onChange={(e) => setF({ ...f, area: e.target.value })} placeholder="Hải Châu, Thanh Khê..." /></label>
        {err && <div className="kc-err">{err}</div>}
      </div>
    </Modal>
  );
}
