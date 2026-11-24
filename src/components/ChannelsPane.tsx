"use client";
/* Mục Kênh (chỉ quản trị): thêm, kết nối, bật gửi tin cho từng kênh. Khuôn: FilterBar, Collapse + strip stat, tw stick, Chip, Modal. */
import { ZALO_PERSONAL_ENABLED } from "@/core/guardrails";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ChannelView, connectConfig } from "@/core/connect";
import type { HistoryJob } from "@/core/history";
import { Chip, Collapse, Ic, Modal, Select, type ChipKind } from "./ui";
import { useActor } from "./actor";

type Config = ReturnType<typeof connectConfig>;
type Kind = "facebook" | "instagram" | "zalo_oa" | "tiktok";
type AnyKind = Kind | "zalo_personal";
const KINDS: Kind[] = ["facebook", "instagram", "zalo_oa", "tiktok"];
const FILTER_KINDS: AnyKind[] = ZALO_PERSONAL_ENABLED ? ["facebook", "instagram", "zalo_oa", "zalo_personal", "tiktok"] : ["facebook", "instagram", "zalo_oa", "tiktok"];
const KIND: Record<string, string> = { facebook: "Messenger", instagram: "Instagram", zalo_oa: "Zalo OA", zalo_personal: "Zalo cá nhân", web: "Web chat", tiktok: "TikTok" };
const STAT: Record<ChannelView["status"], [ChipKind, string]> = {
  connected: ["ok", "Đã kết nối"],
  pending: ["pend", "Chờ cấp quyền"],
  no_token: ["warn", "Chưa có token"],
  expired: ["bad", "Hết hạn, cấp quyền lại"],
};
const day = (t?: number) => (t ? new Date(t).toLocaleDateString("vi-VN") : "—");

async function api(url: string, method = "GET", body?: unknown) {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  return r.json().catch(() => ({}));
}

type MenuItem = { t: string; d?: string; onClick: () => void; disabled?: boolean } | "sep";
// Nút mở menu nhỏ: gom nhiều việc vào một nút để thanh công cụ gọn. Bấm ra ngoài hoặc Esc để đóng.
function Menu({ label, cta, items, title }: { label: React.ReactNode; cta?: boolean; items: MenuItem[]; title?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={ref} className="kc-menu">
      <button type="button" className={`btn ${cta ? "cta" : "tbn"}`} aria-haspopup="menu" aria-expanded={open} title={title} onClick={() => setOpen(!open)}>{label} <span aria-hidden>▾</span></button>
      {open && (
        <div className="kc-menu-pop" role="menu">
          {items.map((it, i) => it === "sep" ? <hr key={i} /> : (
            <button key={i} type="button" role="menuitem" disabled={it.disabled} onClick={() => { setOpen(false); it.onClick(); }}><b>{it.t}</b>{it.d && <small>{it.d}</small>}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ChannelsPane({ back }: { back?: { meta?: string; connected?: string; error?: string } }) {
  const [rows0, setRows] = useState<ChannelView[]>([]);
  const [health, setHealth] = useState<Record<string, { ok: boolean; error?: string; subscribed?: boolean }>>({});
  const { staff } = useActor();
  const [hook, setHook] = useState<{ configured: boolean; reachable?: boolean; url?: string; detail?: string } | null>(null); // địa chỉ webhook công khai còn sống không
  const [rescue, setRescue] = useState("24");
  const [slot, setSlot] = useState<HTMLElement | null>(null); // chỗ trên hàng tiêu đề "Kết nối kênh" (do SettingsPane dựng)
  useEffect(() => { setSlot(document.getElementById("kc-slot-conn")); }, []);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [sf, setSf] = useState("all");
  const [flash, setFlash] = useState<{ ok: boolean; s: string } | null>(null);
  const [add, setAdd] = useState<Kind | null>(null); // cửa sổ thêm tay: loại kênh đang thêm
  const [urls, setUrls] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [chk, setChk] = useState(false); // cửa sổ kiểm tra cài đặt Meta
  const [pick, setPick] = useState<string | null>(null); // mã phiên chọn Page sau khi đăng nhập Facebook
  const [qr, setQr] = useState<{ channelId?: string } | null>(null); // cửa sổ quét QR nối Zalo cá nhân

  const load = useCallback(async () => {
    const j = await api("/api/channels");
    setRows(j.channels ?? []);
    setCfg(j.config ?? null);
    api("/api/channels/health").then((h) => setHealth(h.health ?? {})); // gọi Meta kiểm token từng Page, không chặn danh sách
    api("/api/channels/webhook-status").then((h) => setHook(h.configured === undefined ? null : h)); // địa chỉ webhook công khai còn truy cập được không
  }, []);
  // Token Meta bị thu hồi hoặc hết hạn thì hiện "Hết hạn" ở danh sách, dù KP Chat vẫn còn giữ token
  const rows = useMemo(() => rows0.map((r) => (health[r.id]?.ok === false && r.status === "connected" ? { ...r, status: "expired" as const, note: health[r.id].error } : r)), [rows0, health]);
  const who = (c: ChannelView) => {
    const n = Object.entries(c.access).map(([uid, lv]) => { const s = staff.find((x) => x.uid === uid); return s ? `${s.name} (${lv === "send" ? "nhắn" : "xem"})` : null; }).filter(Boolean);
    return n.length ? n.join(", ") : "Chưa gán nhân viên";
  };
  useEffect(() => {
    load();
    if (back?.meta) setPick(back.meta);
    if (back?.connected) { setFlash({ ok: true, s: "Đã kết nối kênh thành công. Bật gửi tin khi sẵn sàng cho nhân viên." }); setOpen(back.connected); }
    if (back?.error) setFlash({ ok: false, s: back.error });
  }, [load, back]);

  const live = rows.filter((r) => !r.off);
  const need = (r: ChannelView) => r.status !== "connected";
  const counts = { all: live.length, ok: live.filter((r) => r.status === "connected").length, need: live.filter(need).length, expired: live.filter((r) => r.status === "expired").length, off: rows.length - live.length };
  const kc = (k: string) => live.filter((r) => r.kind === k).length;

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (sf === "off" ? !r.off : r.off) return false;
      if (sf === "ok" && r.status !== "connected") return false;
      if (sf === "need" && !need(r)) return false;
      if (sf === "expired" && r.status !== "expired") return false;
      if (kind && r.kind !== kind) return false;
      return !n || r.name.toLowerCase().includes(n) || r.externalId.toLowerCase().includes(n);
    });
  }, [rows, q, kind, sf]);

  const ok = (r: { ok?: boolean; error?: string }, text: string) => setFlash(r.ok ? { ok: true, s: text } : { ok: false, s: r.error ?? "Có lỗi" });
  async function toggle(c: ChannelView) { ok(await api("/api/channels", "PATCH", { id: c.id, sendEnabled: !c.sendEnabled }), c.sendEnabled ? "Đã tắt gửi tin." : "Đã bật gửi tin."); load(); }
  async function remove(c: ChannelView) {
    if (!confirm(`Gỡ kết nối "${c.name}"? Token sẽ bị xóa. Lịch sử hội thoại (nếu có) được giữ lại.`)) return;
    const r = await api(`/api/channels/${c.id}`, "DELETE");
    ok({ ok: r.ok }, r.result === "removed" ? "Đã xóa kênh." : "Đã gỡ kết nối, lịch sử hội thoại được giữ lại.");
    setOpen(null); load();
  }
  async function fbLogin(rerequest = false) {
    const r = await api(`/api/connect/meta/start${rerequest ? "?rerequest=1" : ""}`);
    if (r.ok) location.href = r.url; else ok(r, "");
  }
  const sel = rows.find((r) => r.id === open) ?? null;

  // Ô tìm, lọc loại kênh và nút Thêm kênh nằm trên hàng tiêu đề (qua cổng React), không còn thanh lọc riêng
  const controls = (
    <>
      <input type="search" aria-label="Tìm kênh" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm kênh theo tên hoặc mã" />
      <Select value={kind} options={[["", `Tất cả loại (${live.length})`], ...FILTER_KINDS.map((k) => [k, `${KIND[k]} (${kc(k)})`] as [string, string])]} onChange={setKind} />
      <Menu cta label={<><Ic n="plus" /> Thêm kênh</>} items={[
        { t: "Page Facebook và Instagram", d: "Đăng nhập Facebook rồi chọn Page. Dùng cho mọi Page, kể cả Page mới thêm sau, và để nối lại khi token hết hạn.", onClick: () => fbLogin(false), disabled: !cfg?.meta.loginReady },
        ...(ZALO_PERSONAL_ENABLED ? [{ t: "Zalo cá nhân", d: "Quét QR bằng Zalo trên điện thoại. Nối được nhiều số của nhiều nhân viên.", onClick: () => setQr({}) }] : []),
        { t: "Zalo OA", d: "Kênh chính thức của doanh nghiệp. Cần ứng dụng Zalo và tên miền cố định.", onClick: () => setAdd("zalo_oa") },
        { t: "TikTok", d: "Cần ứng dụng TikTok Business và địa chỉ công khai.", onClick: () => setAdd("tiktok") },
      ]} />
    </>
  );


  return (
    <>
      {slot && createPortal(controls, slot)}

      <Collapse id="kc-ch" summary={`${counts.all} kênh · đã kết nối ${counts.ok} · cần xử lý ${counts.need} · hết hạn ${counts.expired}`}
        status={cfg && <>{!cfg.secretKeySet && <span className="chip warn" title="Chưa đặt KPCHAT_SECRET_KEY: đang dùng khóa tạm, chỉ để thử">Khóa mã hóa tạm</span>}</>}>
        <div className="strip">
          {([["all", "Tất cả", counts.all, ""], ["ok", "Đã kết nối", counts.ok, "o"], ["need", "Cần xử lý", counts.need, "w"], ["expired", "Hết hạn", counts.expired, "b"], ["off", "Đã gỡ", counts.off, ""]] as [string, string, number, string][]).map(([v, t, n, c]) => (
            <button key={v} type="button" className={`stat ${sf === v ? "on" : ""} ${c}`} onClick={() => setSf(v)}><small>{t}</small><b>{n}</b></button>
          ))}
        </div>
      </Collapse>

      {hook?.configured && hook.reachable === false && (
        <div className="note" style={{ background: "var(--bad-bg)", color: "#991B1B" }}>
          <b>Địa chỉ webhook không truy cập được từ bên ngoài</b> ({hook.detail ?? "không kết nối được"}). Meta không gửi được tin mới về KP Chat. Kiểm tra đường hầm hoặc tên miền, rồi khôi phục tin đã lỡ:{" "}
          <Select value={rescue} options={CATCHUP_HOURS} onChange={setRescue} />{" "}
          <button type="button" className="btn sm" onClick={async () => { const r = await api("/api/channels/catchup", "POST", { hours: Number(rescue) }); ok(r.ok ? { ok: true } : r, r.ok ? `Đang khôi phục tin lỡ cho ${r.started.length} kênh${r.skipped.length ? `, bỏ qua ${r.skipped.length} kênh` : ""}. Mở Chi tiết từng Page để xem tiến độ.` : ""); }}>Khôi phục tin lỡ</button>
        </div>
      )}
      {flash && <div className="note" style={flash.ok ? undefined : { background: "var(--bad-bg)", color: "#991B1B" }}>{flash.s} <button type="button" className="btn sm" onClick={() => setFlash(null)}>Đóng</button></div>}
      {cfg?.isLocal && <div className="note i">Đang chạy trên máy ({cfg.publicUrl}). Meta, Zalo, TikTok chỉ gọi được địa chỉ công khai HTTPS: khi thử thật hãy dùng đường hầm (ngrok, cloudflared) và đặt <b>KPCHAT_PUBLIC_URL</b>.</div>}

      <div className="tw m stick rt">
        <table>
          <thead><tr><th>Kênh</th><th>Loại</th><th>Tình trạng</th><th>Hạn cấp quyền</th><th>Gửi tin</th><th /></tr></thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.id} className={`rowc ${c.status === "expired" ? "bad" : need(c) && !c.off ? "warn" : ""}`} onClick={() => setOpen(c.id)}>
                <td className="nm"><b>{c.name}</b><span className="small">{c.externalId ? `Mã: ${c.externalId}` : "Chưa có mã"}{c.pageId ? ` · Page ${c.pageId}` : ""}</span><span className="small" title="Nhân viên được vào kênh này (đổi ở Phân quyền hoặc trong Chi tiết)">Nhân viên: {who(c)}</span></td>
                <td>{KIND[c.kind]}</td>
                <td>{c.off ? <Chip c={["mute", "Đã gỡ kết nối"]} /> : <Chip c={STAT[c.status]} />}</td>
                <td>{c.kind === "facebook" || c.kind === "instagram" ? <span className="kv">Token không hết hạn theo lịch</span> : c.kind === "zalo_personal" ? <span className="kv" title={c.note}>{c.note ? "Cần chú ý" : "Quét lại khi mất kết nối"}</span> : day(c.refreshExpiresAt)}</td>
                <td onClick={(e) => e.stopPropagation()}>{c.off ? <span className="kv">—</span> : <button type="button" className={`btn sm ${c.sendEnabled ? "on" : ""}`} disabled={c.status !== "connected"} title={c.status !== "connected" ? "Cần kết nối xong mới bật được" : ""} onClick={() => toggle(c)}>{c.sendEnabled ? "Đang bật" : "Đang tắt"}</button>}</td>
                <td className="r"><button type="button" className="btn sm">{c.off ? "Xem" : c.status === "connected" ? "Chi tiết" : c.status === "expired" ? "Kết nối lại" : "Kết nối"}</button></td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={6} className="kv" style={{ padding: 20, textAlign: "center" }}>{rows.length ? "Không có kênh nào khớp bộ lọc." : "Chưa có kênh nào. Bấm Thêm kênh để nối Page Facebook hoặc kênh khác."}</td></tr>}
          </tbody>
        </table>
      </div>

      {chk && <MetaCheckModal onClose={() => setChk(false)} />}
      {pick && <PagePickModal session={pick} onRerequest={() => { setPick(null); fbLogin(true); }} onClose={() => setPick(null)} onDone={(text) => { setPick(null); setFlash({ ok: true, s: text }); load(); }} />}
      {qr && <ZaloQrModal channelId={qr.channelId} onClose={() => setQr(null)} onDone={(id, name) => { setQr(null); setFlash({ ok: true, s: `Đã nối Zalo ${name}. Bật gửi tin khi sẵn sàng cho nhân viên.` }); load(); setOpen(id); }} />}
      {add && <AddModal kind={add} onClose={() => setAdd(null)} onDone={(id) => { setAdd(null); load(); setOpen(id); }} />}
      {urls && cfg && <UrlsModal cfg={cfg} onClose={() => setUrls(false)} />}
      {sel && cfg && sel.kind === "zalo_personal" && <ZaloPersonalModal c={sel} agents={staff.filter((s) => s.role === "agent")} onChange={load} onFlash={ok} onClose={() => setOpen(null)} onRescan={() => { setOpen(null); setQr({ channelId: sel.id }); }} onToggle={() => toggle(sel)} onRemove={() => remove(sel)} />}
      {sel && cfg && (sel.kind === "facebook" || sel.kind === "instagram") && <MetaChannelModal c={sel} health={health[sel.id]} onClose={() => setOpen(null)} onChange={load} onFlash={ok} onToggle={() => toggle(sel)} onRemove={() => remove(sel)} onReconnect={() => { setOpen(null); fbLogin(false); }} onCheck={() => { setOpen(null); setChk(true); }} onUrls={() => { setOpen(null); setUrls(true); }} />}
      {sel && cfg && sel.kind !== "zalo_personal" && sel.kind !== "facebook" && sel.kind !== "instagram" && <SetupModal c={sel} cfg={cfg} onClose={() => setOpen(null)} onChange={load} onFlash={ok} onToggle={() => toggle(sel)} onRemove={() => remove(sel)} />}
    </>
  );
}

// Thêm kênh Zalo OA hoặc TikTok: chỉ cần đặt tên, mã tài khoản tự lấy sau khi chủ tài khoản cấp quyền.
// Messenger và Instagram không thêm tay ở đây: dùng Thêm kênh > Page Facebook và Instagram (đăng nhập Facebook).
function AddModal({ kind, onClose, onDone }: { kind: Kind; onClose: () => void; onDone: (id: string) => void }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  async function go() {
    const r = await api("/api/channels", "POST", { kind, name });
    if (!r.ok) return setErr(r.error ?? "Có lỗi");
    onDone(r.channel.id);
  }
  return (
    <Modal small title={kind === "zalo_oa" ? "Thêm kênh Zalo OA" : "Thêm kênh TikTok"} onClose={onClose} footer={<><span className="kv" style={{ color: "var(--bad)" }}>{err}</span><span className="sp" /><button type="button" className="btn" onClick={onClose}>Hủy</button><button type="button" className="btn cta" disabled={!name.trim()} onClick={go}>Thêm kênh</button></>}>
      <div className="mb" style={{ display: "grid", gap: 10 }}>
        <div className="note i" style={{ margin: 0 }}>{kind === "zalo_oa" ? "Tên chỉ để phân biệt trong KP Chat. Mã OA tự lấy sau khi quản trị OA bấm Cho phép ở Zalo." : "Tên chỉ để phân biệt trong KP Chat. Mã tài khoản tự lấy sau khi chủ tài khoản TikTok cấp quyền."} Kênh mới luôn tắt gửi tin cho đến khi bạn bật.</div>
        <label className="kc-fl">Tên hiển thị<input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "zalo_oa" ? "Ví dụ: OA La Bàn" : "Ví dụ: TikTok XuXi"} /></label>
      </div>
    </Modal>
  );
}

function UrlsModal({ cfg, onClose }: { cfg: Config; onClose: () => void }) {
  const [copied, setCopied] = useState("");
  const rows: [string, string][] = [
    ["Webhook Messenger", cfg.webhooks.facebook], ["Webhook Instagram", cfg.webhooks.instagram], ["Webhook Zalo OA", cfg.webhooks.zalo_oa], ["Webhook TikTok", cfg.webhooks.tiktok],
    ["Chuyển hướng đăng nhập Facebook", cfg.redirects.facebook], ["Chuyển hướng cấp quyền Zalo", cfg.redirects.zalo_oa], ["Chuyển hướng cấp quyền TikTok", cfg.redirects.tiktok],
  ];
  return (
    <Modal title="Địa chỉ dán vào trang quản lý của từng nền tảng" onClose={onClose}>
      <div className="mb" style={{ display: "grid", gap: 8 }}>
        {rows.map(([t, u]) => (
          <div key={t}><div className="kv">{t}</div><div className="kc-url"><code>{u}</code><button type="button" className="btn sm" onClick={() => { navigator.clipboard?.writeText(u); setCopied(t); }}>{copied === t ? "Đã chép" : "Chép"}</button></div></div>
        ))}
        <div className="kv">Khóa ứng dụng đặt ở máy chủ qua biến môi trường (không nhập trên giao diện): META_APP_ID, META_APP_SECRET, META_VERIFY_TOKEN, META_LOGIN_CONFIG_ID (nếu dùng Facebook Login for Business), ZALO_APP_ID, ZALO_APP_SECRET, TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_AUTH_URL, KPCHAT_SECRET_KEY, KPCHAT_PUBLIC_URL.</div>
      </div>
    </Modal>
  );
}

// Nối Zalo cá nhân: KP Chat như một trình duyệt đăng nhập Zalo. Quét QR bằng Zalo trên điện thoại.
type QrFlow = { status: "starting" | "qr" | "scanned" | "done" | "expired" | "declined" | "error"; qr?: string; name?: string; avatar?: string; channelId?: string; error?: string };
function ZaloQrModal({ channelId, onClose, onDone }: { channelId?: string; onClose: () => void; onDone: (id: string, name: string) => void }) {
  const [flowId, setFlowId] = useState<string | null>(null);
  const [f, setF] = useState<QrFlow | null>(null);
  const [err, setErr] = useState("");
  const [again, setAgain] = useState(0);
  const finished = useRef(false); // đã nối xong thì không hủy phiên khi đóng cửa sổ
  useEffect(() => {
    let id = "";
    finished.current = false;
    setF(null); setErr(""); setFlowId(null);
    api("/api/connect/zalo-personal", "POST", { channelId }).then((r) => { if (r.ok) { id = r.flow; setFlowId(r.flow); } else setErr(r.error ?? "Có lỗi"); });
    return () => { if (id && !finished.current) api(`/api/connect/zalo-personal?flow=${id}`, "DELETE"); };
  }, [channelId, again]);
  useEffect(() => {
    if (!flowId) return;
    const t = setInterval(async () => {
      const r = await api(`/api/connect/zalo-personal?flow=${flowId}`);
      if (!r.ok) { setErr(r.error ?? "Phiên quét đã hết hạn"); return; }
      setF(r.flow);
      if (r.flow.status === "done") { finished.current = true; onDone(r.flow.channelId, (r.flow.name as string) ?? ""); }
    }, 1500);
    return () => clearInterval(t);
  }, [flowId, onDone]);
  const retry = <button type="button" className="btn cta" onClick={() => setAgain((n) => n + 1)}>Lấy mã mới</button>;
  return (
    <Modal title="Nối Zalo cá nhân bằng QR" onClose={onClose} footer={<><span className="sp" /><button type="button" className="btn p" onClick={onClose}>Đóng</button></>}>
      <div className="mb" style={{ display: "grid", gap: 12, justifyItems: "center", textAlign: "center" }}>
        {err && <div className="note" style={{ background: "var(--bad-bg)", color: "#991B1B" }}>{err} {retry}</div>}
        {!err && (!f || f.status === "starting") && <div className="kv">Đang tạo mã QR...</div>}
        {f?.status === "qr" && f.qr && (<>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={f.qr} alt="Mã QR đăng nhập Zalo" width={220} height={220} style={{ border: "1px solid var(--line)", borderRadius: 8 }} />
          <ol style={{ textAlign: "left", margin: 0, paddingLeft: 18 }}>
            <li>Mở Zalo trên điện thoại của số cần nối.</li>
            <li>Ở mục Cài đặt, bấm nút quét QR rồi quét mã này.</li>
            <li>Bấm xác nhận đăng nhập trên điện thoại.</li>
          </ol>
        </>)}
        {f?.status === "scanned" && <div className="note i">Đã quét bởi <b>{f.name}</b>. Hãy bấm xác nhận trên điện thoại.</div>}
        {f?.status === "done" && <div className="note i">Đã nối xong.</div>}
        {f?.status === "expired" && <div className="note">Mã QR đã hết hạn. {retry}</div>}
        {f?.status === "declined" && <div className="note">Bạn đã từ chối trên điện thoại. {retry}</div>}
        {f?.status === "error" && <div className="note" style={{ background: "var(--bad-bg)", color: "#991B1B" }}>{f.error ?? "Có lỗi"} {retry}</div>}
        <div className="note" style={{ textAlign: "left" }}>
          Đây là cách nối <b>không chính thức</b> (Zalo không có API cho tài khoản cá nhân) và Zalo có thể khoá số nếu thấy bất thường. Chỉ dùng số công ty, không mở Zalo Web cùng số này, và chỉ trả lời tay từng khách.
        </div>
      </div>
    </Modal>
  );
}

function ZaloPersonalModal({ c, agents, onClose, onRescan, onToggle, onRemove, onChange, onFlash }: {
  c: ChannelView; agents: Array<{ uid: string; name: string }>; onClose: () => void; onRescan: () => void; onToggle: () => void; onRemove: () => void;
  onChange: () => void; onFlash: (r: { ok?: boolean; error?: string }, text: string) => void;
}) {
  const conn = c.status === "connected";
  const [name, setName] = useState(c.name);
  async function rename() { onFlash(await api("/api/channels", "PATCH", { id: c.id, name }), "Đã đổi tên kênh."); onChange(); }
  async function setLevel(uid: string, v: string) {
    const next = { ...c.access } as Record<string, "send" | "view">;
    if (v) next[uid] = v as "send" | "view"; else delete next[uid];
    onFlash(await api(`/api/channels/${c.id}/access`, "PUT", { access: next }), "Đã lưu quyền nhân viên.");
    onChange();
  }
  const li = (done: boolean, now: boolean, n: number) => (done ? "done" : now ? "now" : "");
  return (
    <Modal title={<>{c.name} <Chip c={c.off ? ["mute", "Đã gỡ kết nối"] : conn ? ["ok", "Đang kết nối"] : ["bad", "Mất kết nối, quét QR lại"]} /></>} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onRemove}><Ic n="trash" /> {c.off ? "Xóa hẳn" : "Gỡ kết nối"}</button><span className="sp" /><button type="button" className="btn p" onClick={onClose}>Đóng</button></>}>
      <div className="mb">
        <div className="kv" style={{ marginBottom: 8 }}>Zalo cá nhân · Mã {c.externalId}</div>
        {c.off ? <div className="note">Kênh đã gỡ kết nối: không nhận và không gửi tin. Lịch sử hội thoại vẫn được giữ.</div> : (<>
          <div className="kc-url" style={{ marginBottom: 10 }}>
            <span className="kv">Tên kênh</span>
            <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} style={{ flex: 1, padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 8 }} placeholder="Ví dụ: Zalo Lan, Sale 1" />
            <button type="button" className="btn" disabled={!name.trim() || name.trim() === c.name} onClick={rename}>Lưu tên</button>
          </div>
          <ol className="kc-stepl">
            <li className={li(conn, !conn, 1)}><i>{conn ? "✓" : 1}</i>
              <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 6 }}><b>Đăng nhập Zalo bằng QR</b>
                <small>{conn ? "KP Chat đang giữ phiên và nhận tin của số này." : c.note ?? "Chưa đăng nhập hoặc phiên đã hết."}</small>
                {c.note && conn && <small style={{ color: "var(--bad)" }}>{c.note}</small>}
                <button type="button" className={`btn ${conn ? "" : "cta"}`} onClick={onRescan}>{conn ? "Quét QR lại" : "Quét QR"}</button></div></li>
            <li className={li(Object.keys(c.access).length > 0, conn, 2)}><i>{Object.keys(c.access).length > 0 ? "✓" : 2}</i>
              <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 6 }}><b>Nhân viên dùng số này</b>
                <small>Chọn ai được xem hoặc nhắn tin ở số này (thường là nhân viên đang cầm số). Quản trị luôn xem được mọi số để theo dõi.</small>
                <div className="kcp-rows">
                  {agents.map((a) => (
                    <div key={a.uid} className="kc-qrow2"><span style={{ minWidth: 90 }}>{a.name}</span>
                      <Select value={c.access[a.uid] ?? ""} options={[["", "Không vào"], ["view", "Chỉ xem"], ["send", "Nhắn tin"]]} onChange={(v) => setLevel(a.uid, v)} /></div>
                  ))}
                  {agents.length === 0 && <small className="kv">Chưa có nhân viên nào.</small>}
                </div></div></li>
            <li className={li(c.sendEnabled, conn, 3)}><i>{c.sendEnabled ? "✓" : 3}</i>
              <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 6 }}><b>Bật gửi tin cho nhân viên</b>
                <small>Mặc định tắt để tránh nhắn nhầm khách thật. Khi bật, tin gửi cách nhau vài giây và có hạn mức mỗi ngày để giảm nguy cơ bị Zalo khoá số.</small>
                <button type="button" className={`btn ${c.sendEnabled ? "on" : ""}`} disabled={!conn} onClick={onToggle}>{c.sendEnabled ? "Đang bật, bấm để tắt" : "Bật gửi tin"}</button></div></li>
            <li className={li(false, conn, 4)}><i>4</i>
              <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 6 }}><b>Tải tin cũ về (không bắt buộc)</b>
                <small>Tin cũ vào ở trạng thái Đã xong, không chia khách, không tính SLA. Chạy lại không bị trùng. Zalo chỉ trả một phần lịch sử; nên để điện thoại của số này mở và có mạng.</small>
                <HistoryStep c={c} /></div></li>
            <li className={li(false, conn, 5)}><i>5</i>
              <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 6 }}><b>Nhóm chat (không bắt buộc, mặc định tắt)</b>
                <small>Mặc định không có nhóm nào vào hộp thư. Chỉ bật nhóm khách hàng; tránh nhóm riêng tư của nhân viên. Tin nhóm ghi rõ tên người nói.</small>
                <ZaloGroupsStep c={c} onFlash={onFlash} /></div></li>
          </ol>
        </>)}
        <div className="note" style={{ marginTop: 10 }}>Gửi được chữ và ảnh jpg/png (chưa gửi tệp). Không mở Zalo Web cùng số này vì sẽ làm KP Chat bị ngắt.</div>
      </div>
    </Modal>
  );
}

// Bật tắt từng nhóm Zalo của số này. Danh sách lấy từ Zalo khi bấm, thay đổi chỉ ghi khi bấm Lưu.
function ZaloGroupsStep({ c, onFlash }: { c: ChannelView; onFlash: (r: { ok?: boolean; error?: string }, text: string) => void }) {
  const [rows, setRows] = useState<Array<{ id: string; name: string; members?: number; enabled: boolean }> | null>(null);
  const [on, setOn] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function load() {
    setBusy(true); setErr("");
    const r = await api(`/api/connect/zalo-personal/groups?channelId=${encodeURIComponent(c.id)}`);
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? "Có lỗi"); return; }
    setRows(r.groups); setOn(new Set((r.groups as Array<{ id: string; enabled: boolean }>).filter((g) => g.enabled).map((g) => g.id)));
  }
  async function save() {
    setBusy(true);
    const r = await api("/api/connect/zalo-personal/groups", "PUT", { channelId: c.id, groups: [...on] });
    setBusy(false);
    onFlash(r, on.size ? `Đã bật ${on.size} nhóm. Tin nhóm mới sẽ vào hộp thư.` : "Đã tắt hết nhóm.");
    if (r.ok) load();
  }
  const shown = (rows ?? []).filter((g) => !q.trim() || g.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div className="kc-url">
        <button type="button" className="btn" disabled={c.status !== "connected" || busy} onClick={load}>{rows ? "Tải lại danh sách nhóm" : "Xem danh sách nhóm"}</button>
        {rows && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm nhóm" style={{ flex: 1, padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 8 }} />}
      </div>
      {rows && (<>
        <div className="kcp-rows" style={{ maxHeight: 240, overflowY: "auto" }}>
          {shown.map((g) => (
            <label key={g.id} className="kc-qrow2" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={on.has(g.id)} onChange={(e) => setOn((p) => { const n = new Set(p); if (e.target.checked) n.add(g.id); else n.delete(g.id); return n; })} />
              <span style={{ flex: 1, minWidth: 0 }}>{g.name}</span>{g.members != null && <small className="kv">{g.members} người</small>}
            </label>
          ))}
          {shown.length === 0 && <small className="kv">{rows.length ? "Không có nhóm nào khớp." : "Số này chưa tham gia nhóm nào."}</small>}
        </div>
        <div className="kc-url"><small className="kv">Đang chọn {on.size} nhóm</small><span className="sp" /><button type="button" className="btn cta" disabled={busy} onClick={save}>Lưu</button></div>
      </>)}
      {err && <small style={{ color: "var(--bad)" }}>{err}</small>}
    </div>
  );
}

// Chi tiết một Page Messenger hoặc tài khoản Instagram nối bằng đăng nhập Facebook.
function MetaChannelModal({ c, health, onClose, onChange, onFlash, onToggle, onRemove, onReconnect, onCheck, onUrls }: {
  c: ChannelView; health?: { ok: boolean; error?: string; subscribed?: boolean }; onClose: () => void; onChange: () => void;
  onFlash: (r: { ok?: boolean; error?: string }, text: string) => void; onToggle: () => void; onRemove: () => void; onReconnect: () => void;
  onCheck: () => void; onUrls: () => void;
}) {
  const [token, setToken] = useState("");
  const hasToken = c.status !== "no_token" && c.status !== "pending";
  const bad = health?.ok === false;
  const fb = c.kind === "facebook";
  async function saveToken() {
    const r = await api(`/api/channels/${c.id}/meta`, "POST", { token });
    onFlash(r, `Token hợp lệ${r.name ? ` (Page: ${r.name})` : ""} và đã lưu mã hóa.`);
    if (r.ok) setToken("");
    onChange();
  }
  async function subscribe() { onFlash(await api(`/api/channels/${c.id}/meta`, "POST", { subscribe: true }), "Đã đăng ký Page nhận tin về KP Chat."); onChange(); }
  const steps: Step[] = [
    { t: "Kết nối bằng Facebook", done: hasToken && !bad,
      d: bad ? `Token không dùng được (${health?.error}). Đăng nhập Facebook lại và chọn Page này để lấy token mới.` : hasToken ? "Đã kết nối. Token Page không hết hạn theo lịch, chỉ mất khi bị thu hồi hoặc đổi mật khẩu Facebook." : "Chưa có token. Đăng nhập Facebook và chọn Page này.",
      body: <button type="button" className={`btn ${bad || !hasToken ? "cta" : ""}`} onClick={onReconnect}>{hasToken ? "Kết nối lại bằng Facebook" : "Kết nối bằng Facebook"}</button> },
  ];
  if (fb) steps.push({ t: "Đăng ký nhận tin", done: health?.subscribed === true,
    d: health?.subscribed === false ? "Page chưa đăng ký với app, Meta sẽ không gửi tin của Page này về KP Chat." : health?.subscribed ? "Đã đăng ký: tin khách nhắn vào Page sẽ về KP Chat." : "Cho Meta gửi tin khách về KP Chat.",
    body: <button type="button" className="btn" disabled={!hasToken || bad} onClick={subscribe}>{health?.subscribed ? "Đăng ký lại" : "Đăng ký nhận tin"}</button> });
  steps.push({ t: "Bật gửi tin cho nhân viên", d: "Mặc định tắt để tránh nhắn nhầm khách thật.", done: c.sendEnabled,
    body: <button type="button" className={`btn ${c.sendEnabled ? "on" : ""}`} disabled={!hasToken || bad} onClick={onToggle}>{c.sendEnabled ? "Đang bật, bấm để tắt" : "Bật gửi tin"}</button> });
  steps.push({ t: "Tải tin cũ về (không bắt buộc)", d: "Tin cũ vào ở trạng thái Đã xong, không chia khách, không tính SLA. Chạy lại không bị trùng.", done: false, body: <HistoryStep c={c} /> });
  const firstOpen = steps.findIndex((s) => !s.done);
  return (
    <Modal title={<>{c.name} <Chip c={bad ? STAT.expired : STAT[c.status]} /></>} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onRemove}><Ic n="trash" /> Gỡ kết nối</button><span className="sp" /><button type="button" className="btn p" onClick={onClose}>Đóng</button></>}>
      <div className="mb">
        <div className="kv" style={{ marginBottom: 10 }}>{KIND[c.kind]} · Mã {c.externalId}{c.pageId ? ` · Page ${c.pageId}` : ""}</div>
        <ol className="kc-stepl">
          {steps.map((s, i) => (
            <li key={i} className={s.done ? "done" : i === firstOpen ? "now" : ""}>
              <i>{s.done ? "✓" : i + 1}</i>
              <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 6 }}><b>{s.t}</b>{s.d && <small>{s.d}</small>}{s.body}</div>
            </li>
          ))}
        </ol>
        <details style={{ marginTop: 10 }}>
          <summary className="kv" style={{ cursor: "pointer" }}>Nâng cao</summary>
          <div className="kc-url" style={{ marginTop: 8 }}>
            <button type="button" className="btn" onClick={onCheck} title="Từng điều kiện để KP Chat nhận được tin từ Meta">Kiểm tra cài đặt Meta</button>
            <button type="button" className="btn" onClick={onUrls}>Xem địa chỉ webhook</button>
          </div>
          <div className="kv" style={{ marginTop: 10 }}>Dán token Page thủ công (chỉ khi cần sửa token tay):</div>
          <div className="kc-url" style={{ marginTop: 8 }}>
            <input type="password" style={{ flex: 1, padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 8 }} placeholder="Dán token tại đây" value={token} onChange={(e) => setToken(e.target.value)} />
            <button type="button" className="btn cta" disabled={!token.trim()} onClick={saveToken}>Kiểm tra và lưu</button>
          </div>
        </details>
      </div>
    </Modal>
  );
}

const CATCHUP_HOURS: [string, string][] = [["6", "6 giờ gần nhất"], ["24", "24 giờ gần nhất"], ["72", "3 ngày gần nhất"]];
const PERIODS: [string, string][] = [["30", "30 ngày gần nhất"], ["90", "90 ngày gần nhất"], ["180", "6 tháng gần nhất"], ["0", "Toàn bộ"]];

// Tải tin cũ của Page về hộp thư. Chạy nền ở máy chủ, giao diện hỏi tiến độ.
function HistoryStep({ c }: { c: ChannelView }) {
  const [days, setDays] = useState("30");
  const [hours, setHours] = useState("24");
  const meta = c.kind === "facebook" || c.kind === "instagram";
  const [job, setJob] = useState<HistoryJob | null>(null);
  const [err, setErr] = useState("");
  const running = job?.status === "running";
  const poll = useCallback(async () => setJob(((await api(`/api/channels/${c.id}/history`)).job as HistoryJob | null) ?? null), [c.id]);
  useEffect(() => { poll(); }, [poll]);
  useEffect(() => { if (!running) return; const t = setInterval(poll, 2000); return () => clearInterval(t); }, [running, poll]);
  async function start() {
    setErr("");
    const r = await api(`/api/channels/${c.id}/history`, "POST", { days: Number(days) });
    if (!r.ok) setErr(r.error ?? "Có lỗi");
    poll();
  }
  async function catchup() {
    setErr("");
    const r = await api(`/api/channels/${c.id}/history`, "POST", { mode: "catchup", hours: Number(hours) });
    if (!r.ok) setErr(r.error ?? "Có lỗi");
    poll();
  }
  async function stop() { await api(`/api/channels/${c.id}/history`, "DELETE"); poll(); }
  const state = !job ? "" : job.mode === "catchup" ? (job.status === "running" ? "Đang khôi phục tin lỡ..." : job.status === "done" ? "Đã khôi phục tin lỡ." : job.status === "stopped" ? "Đã dừng." : "Lỗi.") : job.status === "running" ? "Đang tải..." : job.status === "done" ? "Đã tải xong." : job.status === "stopped" ? "Đã dừng." : "Lỗi.";
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div className="kc-url">
        <Select value={days} options={PERIODS} onChange={setDays} />
        {running ? <button type="button" className="btn" onClick={stop}>Dừng</button> : <button type="button" className="btn cta" disabled={c.status !== "connected"} onClick={start}>{job ? "Tải lại" : "Tải tin cũ"}</button>}
      </div>
      {meta && !running && (
        <div className="kc-url" title="Dùng khi webhook bị ngắt (đường hầm chết) và tin khách không về. Tin lấy lại được ghi như tin mới, có báo chưa đọc.">
          <Select value={hours} options={CATCHUP_HOURS} onChange={setHours} />
          <button type="button" className="btn" disabled={c.status !== "connected"} onClick={catchup}>Khôi phục tin lỡ</button>
        </div>
      )}
      {job && <small className="kv">{state} {job.conversations} hội thoại, {job.stored} tin mới{job.duplicates ? `, ${job.duplicates} tin đã có` : ""}.{job.error ? <span style={{ color: "var(--bad)" }}> {job.error}</span> : null}</small>}
      {err && <small style={{ color: "var(--bad)" }}>{err}</small>}
    </div>
  );
}

type Step = { t: string; d?: string; done: boolean; body?: React.ReactNode };

function SetupModal({ c, cfg, onClose, onChange, onFlash, onToggle, onRemove }: {
  c: ChannelView; cfg: Config; onClose: () => void; onChange: () => void;
  onFlash: (r: { ok?: boolean; error?: string }, text: string) => void; onToggle: () => void; onRemove: () => void;
}) {
  const [token, setToken] = useState("");
  const meta = c.kind === "facebook" || c.kind === "instagram";
  const conn = c.status === "connected";
  const envOk = meta ? cfg.meta.configured : c.kind === "zalo_oa" ? cfg.zalo.configured : cfg.tiktok.configured && cfg.tiktok.authUrlSet;
  const url = cfg.webhooks[c.kind as Kind];

  async function saveToken() {
    const r = await api(`/api/channels/${c.id}/meta`, "POST", { token });
    onFlash(r, `Token hợp lệ${r.name ? ` (Page: ${r.name})` : ""} và đã lưu mã hóa.`);
    if (r.ok) setToken("");
    onChange();
  }
  async function subscribe() { onFlash(await api(`/api/channels/${c.id}/meta`, "POST", { subscribe: true }), "Đã đăng ký Page nhận tin về KP Chat."); }
  async function oauth(p: "zalo" | "tiktok") {
    const r = await api(`/api/connect/${p}/start?channel=${encodeURIComponent(c.id)}`);
    if (r.ok) location.href = r.url; else onFlash(r, "");
  }
  async function ttHook() { onFlash(await api("/api/connect/tiktok/webhook", "POST"), "Đã đăng ký webhook TikTok cho ứng dụng."); }

  const urlRow = (u: string, label: string) => <div className="kc-url"><span className="kv">{label}</span><code>{u}</code><button type="button" className="btn sm" onClick={() => navigator.clipboard?.writeText(u)}>Chép</button></div>;
  const steps: Step[] = [
    { t: "Đặt khóa ứng dụng ở máy chủ", d: envOk ? "Đã có." : meta ? "Cần META_APP_SECRET và META_VERIFY_TOKEN (lấy ở trang quản lý app Meta)." : c.kind === "zalo_oa" ? "Cần ZALO_APP_ID và ZALO_APP_SECRET." : "Cần TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET và TIKTOK_AUTH_URL.", done: envOk },
    { t: "Dán địa chỉ vào trang quản lý nền tảng", d: "Webhook để nhận tin" + (c.kind === "zalo_oa" ? ", chuyển hướng để cấp quyền." : c.kind === "tiktok" ? " và địa chỉ chuyển hướng cấp quyền." : "."), done: conn,
      body: <>{urlRow(url, "Webhook")}{c.kind === "zalo_oa" && urlRow(cfg.redirects.zalo_oa, "Chuyển hướng")}{c.kind === "tiktok" && urlRow(cfg.redirects.tiktok, "Chuyển hướng")}</> },
  ];
  if (meta) {
    steps.push({ t: "Dán Page access token", d: conn ? "Đã lưu mã hóa." : "Lấy ở Meta, hệ thống kiểm đúng Page rồi mới lưu.", done: conn,
      body: <div className="kc-url"><input type="password" style={{ flex: 1, padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 8 }} placeholder="Dán token tại đây" value={token} onChange={(e) => setToken(e.target.value)} /><button type="button" className="btn cta" disabled={!token.trim()} onClick={saveToken}>Kiểm tra và lưu</button></div> });
    steps.push({ t: "Đăng ký Page nhận tin", d: "Cho Meta gửi tin khách về KP Chat.", done: false, body: <button type="button" className="btn" disabled={!conn} onClick={subscribe}>Đăng ký nhận tin</button> });
  } else {
    steps.push({ t: c.kind === "zalo_oa" ? "Quản trị OA cấp quyền" : "Chủ tài khoản TikTok cấp quyền", d: conn ? "Đã cấp quyền." : c.kind === "tiktok" ? "TikTok cần duyệt quyền truy cập tin nhắn cho ứng dụng trước." : "Mở trang Zalo, chọn OA và bấm Cho phép.", done: conn,
      body: <button type="button" className="btn cta" disabled={!envOk} onClick={() => oauth(c.kind === "zalo_oa" ? "zalo" : "tiktok")}>{conn ? "Cấp quyền lại" : "Cấp quyền"}</button> });
    if (c.kind === "tiktok") steps.push({ t: "Đăng ký webhook cho ứng dụng (một lần)", d: "Cần địa chỉ công khai HTTPS.", done: false, body: <button type="button" className="btn" disabled={!envOk} onClick={ttHook}>Đăng ký webhook</button> });
  }
  steps.push({ t: "Bật gửi tin cho nhân viên", d: "Mặc định tắt để tránh nhắn nhầm khách thật.", done: c.sendEnabled, body: <button type="button" className={`btn ${c.sendEnabled ? "on" : ""}`} disabled={!conn} onClick={onToggle}>{c.sendEnabled ? "Đang bật, bấm để tắt" : "Bật gửi tin"}</button> });
  if (meta) steps.push({ t: "Tải tin cũ về (không bắt buộc)", d: "Tin cũ vào ở trạng thái Đã xong, không chia khách, không tính SLA. Chạy lại không bị trùng.", done: false, body: <HistoryStep c={c} /> });
  const firstOpen = steps.findIndex((s) => !s.done);

  return (
    <Modal title={<>{c.name} <Chip c={c.off ? ["mute", "Đã gỡ kết nối"] : STAT[c.status]} /></>} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onRemove}><Ic n="trash" /> {c.off ? "Xóa hẳn" : "Gỡ kết nối"}</button><span className="sp" /><button type="button" className="btn p" onClick={onClose}>Đóng</button></>}>
      <div className="mb">
        <div className="kv" style={{ marginBottom: 10 }}>{KIND[c.kind]}{c.externalId ? ` · Mã ${c.externalId}` : ""}{c.pageId ? ` · Page ${c.pageId}` : ""}</div>
        {c.off ? <div className="note">Kênh đã gỡ kết nối: không nhận và không gửi tin. Lịch sử hội thoại vẫn được giữ.</div> : (
          <ol className="kc-stepl">
            {steps.map((s, i) => (
              <li key={i} className={s.done ? "done" : i === firstOpen ? "now" : ""}>
                <i>{s.done ? "✓" : i + 1}</i>
                <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 6 }}><b>{s.t}</b>{s.d && <small>{s.d}</small>}{s.body}</div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Modal>
  );
}

interface PickPage { id: string; name: string; tasks?: string[]; canMessage: boolean; ig?: { id: string; username?: string }; connected: boolean; igConnected: boolean }

function PagePickModal({ session, onClose, onDone, onRerequest }: { session: string; onClose: () => void; onDone: (text: string) => void; onRerequest: () => void }) {
  const [pages, setPages] = useState<PickPage[] | null>(null);
  const [diag, setDiag] = useState<{ granted: string[]; declined: string[]; sharedPageIds: string[]; returned: number; missing: string[]; usedConfigId: boolean; rerequest: boolean; error?: string } | null>(null);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<Record<string, { on: boolean; ig: boolean }>>({});
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Array<{ name: string; ok: boolean; note: string }> | null>(null);
  const [q, setQ] = useState("");
  const [flt, setFlt] = useState("all");
  useEffect(() => {
    api(`/api/connect/meta/pages?session=${encodeURIComponent(session)}`).then((j) => {
      if (!j.ok) return setErr(j.error ?? "Không tải được danh sách Page");
      setPages(j.pages);
      setDiag(j.diag ?? null);
      setSel(Object.fromEntries((j.pages as PickPage[]).map((p) => [p.id, { on: p.canMessage && !p.connected, ig: !!p.ig && !p.igConnected }])));
    });
  }, [session]);
  const count = useMemo(() => ({
    all: pages?.length ?? 0,
    new: pages?.filter((p) => p.canMessage && !p.connected).length ?? 0,
    linked: pages?.filter((p) => p.connected).length ?? 0,
    noperm: pages?.filter((p) => !p.canMessage).length ?? 0,
  }), [pages]);
  const shown = useMemo(() => (pages ?? []).filter((p) => {
    const n = q.trim().toLowerCase();
    if (n && !(p.name.toLowerCase().includes(n) || p.id.includes(n))) return false;
    if (flt === "new") return p.canMessage && !p.connected;
    if (flt === "linked") return p.connected;
    if (flt === "noperm") return !p.canMessage;
    return true;
  }), [pages, q, flt]);
  const n = Object.entries(sel).filter(([, v]) => v.on).length;
  function pickShown(on: boolean) {
    setSel((s) => { const next = { ...s }; for (const p of shown) if (p.canMessage) next[p.id] = { ig: next[p.id]?.ig ?? false, on }; return next; });
  }
  async function go() {
    setBusy(true);
    const picks = Object.entries(sel).filter(([, v]) => v.on).map(([pageId, v]) => ({ pageId, instagram: v.ig }));
    const j = await api("/api/connect/meta/pages", "POST", { session, picks });
    setBusy(false);
    if (!j.ok) return setErr(j.error ?? "Có lỗi");
    setRes(j.results);
  }
  const done = res ? () => onDone(`Đã nối ${res.filter((r) => r.ok).length} kênh. Bật gửi tin khi sẵn sàng.`) : onClose;
  return (
    <Modal wide title="Chọn Page để nối" onClose={done}
      footer={res ? <><span className="sp" /><button className="btn cta" onClick={done}>Xong</button></>
        : <><span className="kv" style={{ color: "var(--bad)" }}>{err}</span><span className="sp" /><button className="btn" onClick={onClose}>Hủy</button><button className="btn cta" disabled={!n || busy} onClick={go}>{busy ? "Đang nối..." : `Nối ${n} Page`}</button></>}>
      <div className="mb" style={{ display: "grid", gap: 8 }}>
        {res ? res.map((r, i) => <div key={i} className="note" style={r.ok ? { background: "var(--ok-bg)", color: "#166534", margin: 0 } : { background: "var(--bad-bg)", color: "#991B1B", margin: 0 }}><b>{r.name}</b>: {r.note}</div>)
          : !pages ? <div className="kv">{err || "Đang tải danh sách Page..."}</div>
          : <>
            <div className="kv">Facebook trả về <b>{count.all}</b> Page: {count.new} chưa nối, {count.linked} đã nối{count.noperm ? `, ${count.noperm} thiếu quyền Nhắn tin` : ""}. Chọn Page muốn nhận tin về KP Chat. Nhân viên không cần quyền gì trên Facebook. Kênh mới luôn tắt gửi tin.</div>
            <div className="kc-pickbar">
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên hoặc mã Page" />
              <Select value={flt} options={[["all", `Tất cả (${count.all})`], ["new", `Chưa nối (${count.new})`], ["linked", `Đã nối (${count.linked})`], ["noperm", `Thiếu quyền (${count.noperm})`]]} onChange={setFlt} />
              <button type="button" className="btn sm" onClick={() => pickShown(true)}>Chọn các Page đang hiện</button>
              <button type="button" className="btn sm" onClick={() => pickShown(false)}>Bỏ chọn</button>
            </div>
            <div className="tw m" style={{ maxHeight: 360, overflow: "auto" }}><table><thead><tr><th style={{ width: 40 }} /><th>Page</th><th>Instagram liên kết</th><th>Tình trạng</th></tr></thead><tbody>
              {shown.map((p) => (
                <tr key={p.id} className={p.canMessage ? "" : "warn"}>
                  <td><input type="checkbox" aria-label={`Nối ${p.name}`} disabled={!p.canMessage} checked={!!sel[p.id]?.on} onChange={(e) => setSel({ ...sel, [p.id]: { ig: sel[p.id]?.ig ?? false, on: e.target.checked } })} /></td>
                  <td className="nm"><b>{p.name}</b><span className="small">Mã {p.id}</span></td>
                  <td>{p.ig ? <label style={{ display: "inline-flex", gap: 6 }}><input type="checkbox" disabled={!p.canMessage || p.igConnected} checked={!!sel[p.id]?.ig && !p.igConnected} onChange={(e) => setSel({ ...sel, [p.id]: { on: sel[p.id]?.on ?? false, ig: e.target.checked } })} /> @{p.ig.username ?? p.ig.id}{p.igConnected ? " (đã nối)" : ""}</label> : <span className="kv">—</span>}</td>
                  <td>{!p.canMessage ? <Chip c={["warn", "Thiếu quyền Nhắn tin"]} /> : p.connected ? <Chip c={["ok", "Đã nối, chọn để cập nhật token"]} /> : <Chip c={["pend", "Chưa nối"]} />}</td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={4} className="kv" style={{ padding: 16, textAlign: "center" }}>Không có Page nào khớp.</td></tr>}
            </tbody></table></div>
            {diag && diag.missing.length > 0 && <div className="note" style={{ margin: 0, background: "var(--warn-bg)" }}>Facebook báo bạn đã chia sẻ {diag.sharedPageIds.length} Page cho KP Chat nhưng chỉ trả về {diag.returned} Page ({diag.missing.length} Page thiếu, mã {diag.missing.join(", ")}). Thường là Page thuộc Business Portfolio mà tài khoản đăng nhập chưa có quyền Nhắn tin: kiểm tra vai trò trên Page ở Business Settings.</div>}
            {diag && diag.declined.length > 0 && <div className="note" style={{ margin: 0, background: "var(--warn-bg)" }}>Bạn đã từ chối quyền: {diag.declined.join(", ")}. Bấm "Chọn lại quyền Facebook" và chấp nhận.</div>}
            <div className="note" style={{ margin: 0 }}>Không thấy Page cần nối? Facebook chỉ trả các Page bạn đã chia sẻ cho KP Chat ở bước đăng nhập. <button type="button" className="btn sm" onClick={onRerequest}>Chọn lại quyền Facebook</button> Nếu bấm mà Facebook không hiện lại hộp chọn Page: mở <b>Facebook &gt; Cài đặt &gt; Tích hợp doanh nghiệp &gt; KP Chat &gt; Chỉnh sửa</b>, thêm Page, rồi đăng nhập lại ở đây.{diag && <span className="small" style={{ display: "block", marginTop: 4 }}>Chi tiết kỹ thuật: Facebook trả {diag.returned} Page, đã chia sẻ {diag.sharedPageIds.length}; quyền đã cấp {diag.granted.length}; {diag.usedConfigId ? "dùng cấu hình đăng nhập (config_id)" : "dùng danh sách quyền"}{diag.rerequest ? ", hỏi lại quyền" : ""}{diag.error ? `; lỗi chẩn đoán: ${diag.error}` : ""}. Nhật ký máy chủ có dòng bắt đầu bằng [meta-login].</span>}</div>
          </>}
      </div>
    </Modal>
  );
}

interface MetaCheck { id: string; level: "ok" | "warn" | "bad" | "info"; title: string; detail: string }
const LV: Record<MetaCheck["level"], [ChipKind, string]> = { ok: ["ok", "Đạt"], warn: ["warn", "Nên xem"], bad: ["bad", "Chưa đạt"], info: ["pend", "Lưu ý"] };

function MetaCheckModal({ onClose }: { onClose: () => void }) {
  const [checks, setChecks] = useState<MetaCheck[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; s: string } | null>(null);
  const run = useCallback(async () => { setChecks(null); const j = await api("/api/connect/meta/check"); setChecks(j.checks ?? []); }, []);
  useEffect(() => { run(); }, [run]);
  async function fixWebhook() {
    const r = await api("/api/connect/meta/check", "POST");
    setMsg(r.ok ? { ok: true, s: "Đã cấu hình webhook cho ứng dụng. Đang kiểm tra lại..." } : { ok: false, s: r.error ?? "Có lỗi" });
    if (r.ok) run();
  }
  const bad = checks?.filter((c) => c.level === "bad").length ?? 0;
  const subBad = checks?.some((c) => c.id === "sub" && c.level !== "ok");
  const canFix = subBad && checks?.find((c) => c.id === "env")?.level === "ok" && checks?.find((c) => c.id === "public")?.level === "ok" && checks?.find((c) => c.id === "reach")?.level === "ok";
  return (
    <Modal wide title="Kiểm tra cài đặt Meta" onClose={onClose}
      footer={<><span className="kv">{checks ? (bad ? `${bad} điều kiện chưa đạt` : "Mọi điều kiện đã đạt") : "Đang kiểm tra..."}</span><span className="sp" /><button className="btn" onClick={run}><Ic n="sync" /> Kiểm tra lại</button><button className="btn p" onClick={onClose}>Đóng</button></>}>
      <div className="mb" style={{ display: "grid", gap: 8 }}>
        {msg && <div className="note" style={{ margin: 0, ...(msg.ok ? {} : { background: "var(--bad-bg)", color: "#991B1B" }) }}>{msg.s}</div>}
        {!checks && <div className="kv">Đang gọi Meta và gọi thử địa chỉ công khai của KP Chat...</div>}
        {checks?.map((c) => (
          <div key={c.id} className="card" style={{ padding: "10px 12px", display: "flex", gap: 10, alignItems: "flex-start" }}>
            <Chip c={LV[c.level]} />
            <div style={{ minWidth: 0 }}><b>{c.title}</b><div className="kv" style={{ fontSize: 13 }}>{c.detail}</div>
              {c.id === "sub" && c.level !== "ok" && <button className="btn sm" style={{ marginTop: 6 }} disabled={!canFix} title={canFix ? "" : "Cần đạt các điều kiện phía trên trước"} onClick={fixWebhook}>Tự cấu hình webhook</button>}
            </div>
          </div>
        ))}
        {checks && <div className="kv">Phép kiểm tra gọi Meta bằng khóa ứng dụng và token Page đã lưu (chỉ đọc) và gọi thử địa chỉ webhook của chính KP Chat. Không gửi tin nào cho khách.</div>}
      </div>
    </Modal>
  );
}
