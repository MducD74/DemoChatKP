"use client";
/* Tab Chatbot (quản trị): chỉ hiện các chatbot đã tạo. Bấm Thêm chatbot để chọn loại, kênh, chế độ và quy tắc riêng. */
import { useCallback, useEffect, useState } from "react";
import type { BotMode } from "@/core/types";
import type { BotCfg, BotType, KnowledgeDoc } from "@/core/chatbot";
import { Ic, Modal, usePersist } from "./ui";
import { tidyText } from "@/core/texttidy";
import { DEFAULT_BOT_STAGES, STAGES, botStages } from "@/core/convmeta";
import type { Script, ScriptLib } from "@/core/botscripts";
import type { Brand } from "@/core/brands";
import { BRAND_KINDS, PROFILE_LIMITS, fieldsOf, filledCount, type BrandKind } from "@/core/brandprofile";
import BotEvalPanel from "./BotEvalPanel";
import BotHistory from "./BotHistory";
import BotPreview from "./BotPreview";
import "./pages/botpage.css";

const KIND: Record<string, string> = { facebook: "Messenger", instagram: "Instagram", zalo_oa: "Zalo OA", zalo_personal: "Zalo cá nhân", web: "Web chat", tiktok: "TikTok" };
const COLOR: Record<string, string> = { facebook: "#1877F2", instagram: "#DB2777", zalo_oa: "#0068FF", zalo_personal: "#0EA5E9", web: "#0F766E", tiktok: "#111" };
const MODES: [BotMode, string, string][] = [
  ["draft", "Soạn nháp cho nhân viên", "Nháp hiện trong khung chat. Nhân viên bấm Dùng, Sửa hoặc Bỏ. Chatbot không tự gửi."],
  ["shadow", "Gợi ý tham khảo", "Chatbot soạn gợi ý cho mọi tin khách. Nhân viên thấy gợi ý để học cách tư vấn và chép vào ô soạn nếu muốn; chatbot không gửi gì."],
  // Không có "Tự trả lời": ràng buộc dự án, chatbot không bao giờ tự gửi cho khách (src/core/guardrails.ts)
  ["off", "Tạm tắt", "Giữ cấu hình nhưng chatbot không làm gì."],
];
const MODE_NAME = Object.fromEntries(MODES.map(([m, t]) => [m, t])) as Record<BotMode, string>;
const LIM = { handoff: 300, name: 60, description: 140, tone: 300, intro: 300, instructions: 6000, docs: 30, body: 20000, title: 80 };

interface Chan { id: string; name: string; kind: string; sendEnabled: boolean }
interface Stats { last24h: number; auto: number; used: number; edited: number; discarded: number; pending: number; handoff: number; shadow: number; errors: number; tokensIn: number; tokensOut: number }
interface WebChat { id: string; name: string; key: string; title: string; greeting: string; color: string; origins: string; position: "right" | "left" }
interface WcForm { id?: string; name: string; title: string; greeting: string; color: string; origins: string; position: "right" | "left"; err: string; busy: boolean; attachBot?: string; attachForm?: boolean }
interface Outcome { convs: number; withPhone: number; handoffs: number; phoneRate: number; handoffRate: number }
interface View {
  outcomes: Record<string, Outcome>;
  scripts: Script[]; scriptLibs: [ScriptLib, string, string][]; brands: Brand[]; adviceTemplates: { new: string; care: string };
  webchats: WebChat[]; base: string;
  settings: { docs: (KnowledgeDoc & { category?: string; channelIds?: string[] })[]; paused?: boolean; dailyCap?: number };
  bots: (BotCfg & { stats: Stats })[];
  types: [BotType, string, string][]; tones: string[]; docCategories: string[]; models: [string, string][];
  defaults: { model: string; intro: string };
  provider: { ready: boolean; id: string | null }; stats: Stats; channels: Chan[];
}
type SrcType = "text" | "file" | "web" | "drive" | "product";
type Doc = { id?: string; title: string; body: string; at?: number; category?: string; channelIds?: string[]; brandId?: string; source?: { type: SrcType; url?: string; fileName?: string; truncated?: boolean; auto?: boolean; checkedAt?: number; issue?: string } };
const SRC: [SrcType, string][] = [["text", "Văn bản"], ["file", "Tệp"], ["web", "Web"], ["drive", "Drive"], ["product", "Sản phẩm KP"]];
const srcOf = (d: Doc): SrcType => d.source?.type ?? "text";
type Sub = "bot" | "brand" | "kb" | "log";
const SHARED = "shared"; // tài liệu Dùng chung (khớp core/brands.ts)
const allowedDoc = (docBrand?: string, botBrand?: string) => !botBrand || docBrand === SHARED || docBrand === botBrand;
interface BrForm { id?: string; name: string; kind: BrandKind; website: string; note: string; channelIds: string[]; profile: Record<string, string>; tab: "profile" | "info"; orig: string; ok: string; err: string; busy: boolean }
const brOrigOf = (f: { name: string; kind: BrandKind; website: string; note: string; channelIds: string[]; profile: Record<string, string> }) => JSON.stringify([f.name.trim(), f.kind, f.website.trim(), f.note.trim(), [...f.channelIds].sort(), Object.entries(f.profile).filter(([, t]) => t.trim()).map(([k, t]) => [k, t.trim()]).sort()]);
const brOpen = (b?: Brand): BrForm => { const f = { name: b?.name ?? "", kind: b?.kind ?? "retail" as BrandKind, website: b?.website ?? "", note: b?.note ?? "", channelIds: [...(b?.channelIds ?? [])], profile: { ...(b?.profile ?? {}) } }; return { id: b?.id, ...f, tab: b ? "profile" : "info", orig: brOrigOf(f), ok: "", err: "", busy: false }; };
type PageTab = "inst" | "kb" | "script" | "conf" | "eval" | "log"; // các tab trong trang riêng của một chatbot
const SC_PROMPT = 8000; // giới hạn chữ kịch bản đưa vào lời nhắc (khớp SCRIPT_LIMITS.prompt ở core/botscripts.ts; không import vì file đó nạp mã máy chủ)
const SC_PER_BOT = 20;
const SC_LIM = { title: 80, when: 200, body: 3000 };
interface ScForm { id?: string; botId?: string; from?: string; lib: ScriptLib; title: string; when: string; body: string; err: string; busy: boolean }
const sameStages = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
// Loại chatbot không còn chọn tay: suy ra từ giai đoạn phụ trách (có giai đoạn của khách mới là chốt sale, chỉ lo Chuyển đổi là chăm sóc)
const typeOf = (stages: string[]): BotType => (stages.some((k) => DEFAULT_BOT_STAGES.new.includes(k)) ? "new" : "care");
interface AddForm { attach?: string; brandId: string; kind: "text" | "file" | "web" | "drive"; name: string; category: string; channelIds: string[]; text: string; url: string; file: File | null; busy: boolean; err: string }
const blankAdd = (brandId = ""): AddForm => ({ brandId, kind: "text", name: "", category: "", channelIds: [], text: "", url: "", file: null, busy: false, err: "" });
interface Form { id?: string; brandId: string; adviceInline: boolean; stages: string[]; name: string; description: string; handoffMsg: string; type: BotType; channelIds: string[]; mode: BotMode; tone: string; instructions: string; docIds: string[]; useTemplates: boolean; model: string; intro: string }

const formOf = (b: BotCfg): Form => ({ id: b.id, brandId: b.brandId ?? "", adviceInline: !!b.adviceInline, stages: [...botStages(b)], name: b.name, description: b.description ?? "", handoffMsg: b.handoffMsg ?? "", type: b.type, channelIds: b.channelIds, mode: b.mode, tone: b.tone, instructions: b.instructions, docIds: b.docIds, useTemplates: b.useTemplates, model: b.model, intro: b.intro });

async function api(url: string, method = "GET", body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  return r.json().catch(() => ({}));
}

export default function BotPanel() {
  const [v, setV] = useState<View | null>(null);
  const [subRaw, setSub] = usePersist<Sub | "script" | "eval" | ScriptLib>("kc.botsub", "bot");
  const sub: Sub = subRaw === "kb" || subRaw === "log" || subRaw === "brand" ? subRaw : "bot"; // các mục "script", "eval", "sale", "care" đã bỏ khỏi tab chung (kịch bản và đánh giá nằm trong trang từng chatbot)
  const [form, setForm] = useState<Form | null>(null);
  const [formErr, setFormErr] = useState("");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [cap, setCap] = useState("");
  const [paused, setPaused] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [add, setAdd] = useState<AddForm | null>(null);
  const [embed, setEmbed] = useState<string | null>(null);
  const [wc, setWc] = useState<WcForm | null>(null);
  const [copied, setCopied] = useState("");
  const [ed, setEd] = useState<{ i: number; title: string; category: string; channelIds: string[]; brandId: string; body: string; err: string } | null>(null);
  const [br, setBr] = useState<BrForm | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; s: string } | null>(null);
  const [sc, setSc] = useState<ScForm | null>(null);
  const [openId, setOpenId] = usePersist<string>("kc.botopen", ""); // trang riêng đang mở: mã chatbot, "new" là chatbot mới, "" là danh sách
  const [pageTabRaw, setPageTab] = usePersist<PageTab | "set">("kc.botpagetab", "inst");
  const pageTab: PageTab = pageTabRaw === "set" ? "inst" : pageTabRaw; // "set" là giá trị cũ đã lưu trong trình duyệt
  const [formOk, setFormOk] = useState("");
  const [pickSc, setPickSc] = useState(false);

  const apply = useCallback((j: View) => {
    setV(j);
    setDocs(j.settings.docs.map((d) => ({ id: d.id, title: d.title, body: d.body, at: d.at, source: d.source, category: d.category, channelIds: d.channelIds, brandId: d.brandId })));
    setCap(j.settings.dailyCap ? String(j.settings.dailyCap) : "");
    setPaused(!!j.settings.paused);
    setDirty(false);
  }, []);
  const load = useCallback(() => api("/api/bot").then((j) => { if (j.settings) apply(j); }), [apply]);
  useEffect(() => { load(); }, [load]);
  // Trang riêng của chatbot vừa khít màn hình: đo chỗ trang bắt đầu, trừ phần tràn nếu cả trang vẫn cuộn được (để cả trang không cuộn, ô Xem thử không bị lắc)
  useEffect(() => {
    const fit = () => {
      const el = document.querySelector<HTMLElement>(".bp");
      if (!el) return;
      const top = Math.round(el.getBoundingClientRect().top + window.scrollY) + 14;
      el.style.setProperty("--bp-top", `${top}px`);
      const over = document.documentElement.scrollHeight - window.innerHeight;
      if (over > 0) el.style.setProperty("--bp-top", `${top + over}px`);
    };
    fit();
    const t = setTimeout(fit, 300);
    window.addEventListener("resize", fit);
    return () => { clearTimeout(t); window.removeEventListener("resize", fit); };
  }, [v, openId, form === null, pageTab, br === null]);
  // tải lại trang khi đang mở trang riêng của một chatbot: dựng lại form từ chatbot đã lưu; chatbot đã xóa thì về danh sách
  useEffect(() => {
    if (!v || !openId || openId === "new" || form) return;
    const b = v.bots.find((x) => x.id === openId);
    if (b) setForm(formOf(b)); else setOpenId("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, openId, form]);

  if (!v) return <div className="kv">Đang tải...</div>;
  const chName = (id: string) => v.channels.find((c) => c.id === id)?.name ?? "(kênh đã gỡ)";

  const blank = (): Form => ({ brandId: v.brands.length === 1 ? v.brands[0].id : "", adviceInline: true, stages: [...DEFAULT_BOT_STAGES.new], name: "", description: "", handoffMsg: "", type: "new", channelIds: [], mode: "draft", tone: v.tones[0], instructions: "", docIds: v.settings.docs.map((d) => d.id), useTemplates: true, model: v.defaults.model, intro: v.defaults.intro });
  const edit = formOf;
  const setF = (p: Partial<Form>) => { setForm((f) => (f ? { ...f, ...p } : f)); setFormErr(""); };
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  async function saveForm() {
    if (!form) return;
    const was = v?.bots.find((b) => b.id === form.id)?.mode;
    if (form.mode === "auto" && was !== "auto" && !confirm("Chatbot sẽ tự gửi tin cho khách thật ở các kênh đã chọn. Bật chế độ Tự trả lời?")) return;
    const r = await api("/api/bot/bots", "POST", { ...form, type: typeOf(form.stages) });
    if (!r.ok) { setFormOk(""); return setFormErr(r.error ?? "Không lưu được"); }
    setFormErr("");
    if (r.bot) { setForm(formOf(r.bot as BotCfg)); if (!form.id) setOpenId((r.bot as BotCfg).id); }
    setFormOk(form.id ? "Đã lưu." : "Đã tạo chatbot. Thêm kiến thức, kịch bản ở các tab bên cạnh.");
    await load();
  }
  function openPage(b: BotCfg) { setForm(formOf(b)); setFormErr(""); setFormOk(""); setPageTab("inst"); setOpenId(b.id); }
  function newPage() { setForm(blank()); setFormErr(""); setFormOk(""); setPageTab("inst"); setOpenId("new"); }
  function closePage(force = false) {
    if (!force && formDirty && !confirm("Bỏ các thay đổi chưa lưu ở trang chatbot này?")) return;
    setForm(null); setFormErr(""); setFormOk(""); setOpenId("");
  }
  // Gắn hoặc bỏ một tài liệu của chatbot đang mở: lưu liền (không chờ nút Lưu của tab Cài đặt)
  async function attachDocs(b: BotCfg, docIds: string[]) {
    setMsg(null);
    const r = await api("/api/bot/bots", "POST", { ...b, docIds });
    if (!r.ok) return setMsg({ ok: false, s: r.error ?? "Không lưu được" });
    setForm((f) => (f && f.id === b.id ? { ...f, docIds } : f));
    await load();
  }
  async function remove(b: BotCfg) {
    if (!confirm(`Xóa chatbot "${b.name}"? Kịch bản riêng của chatbot này cũng bị xóa. Các nháp cũ vẫn được giữ trong thống kê.`)) return;
    await api("/api/bot/bots", "DELETE", { id: b.id });
    if (openId === b.id) closePage(true);
    load();
  }
  async function setMode(b: BotCfg, mode: BotMode) {
    if (mode === "auto" && !confirm(`Bật Tự trả lời cho "${b.name}"? Chatbot sẽ tự gửi tin cho khách thật.`)) return;
    const r = await api("/api/bot/bots", "POST", { ...b, mode });
    if (!r.ok) setMsg({ ok: false, s: r.error ?? "Lỗi" });
    else setForm((f) => (f && f.id === b.id ? { ...f, mode } : f)); // trang đang mở không bị coi là có thay đổi chưa lưu
    load();
  }
  async function saveGeneral() {
    const j = await api("/api/bot", "PUT", { docs, paused, dailyCap: cap.trim() === "" ? null : Number(cap) });
    if (!j.ok) return setMsg({ ok: false, s: j.error ?? "Lỗi" });
    apply(j);
    setMsg({ ok: true, s: "Đã lưu." });
  }
  async function submitAdd() {
    if (!add) return;
    const name = add.name.trim();
    if (add.kind === "text") {
      if (!name) return setAdd({ ...add, err: "Nhập tên tài liệu" });
      if (!add.text.trim()) return setAdd({ ...add, err: "Nhập nội dung" });
      setAdd({ ...add, busy: true, err: "" });
      const j = await api("/api/bot", "PUT", { docs: [...docs, { title: name, body: add.text, category: add.category || undefined, channelIds: add.channelIds, brandId: add.brandId || undefined }], paused, dailyCap: cap.trim() === "" ? null : Number(cap) });
      if (!j.ok) return setAdd({ ...add, busy: false, err: j.error ?? "Không thêm được" });
      setAdd(null);
      apply(j);
      await attachNew(add.attach, j);
      return;
    }
    if (add.kind === "file" && !add.file) return setAdd({ ...add, err: "Chọn một tệp" });
    if (add.kind !== "file" && !add.url.trim()) return setAdd({ ...add, err: "Dán link" });
    if (dirty) await saveGeneral();
    setAdd({ ...add, busy: true, err: "" });
    let r;
    if (add.kind === "file" && add.file) {
      const fd = new FormData();
      fd.set("file", add.file);
      if (name) fd.set("title", name);
      fd.set("category", add.category);
      fd.set("brandId", add.brandId);
      fd.set("channelIds", JSON.stringify(add.channelIds));
      r = await fetch("/api/bot/docs", { method: "POST", body: fd }).then((x) => x.json()).catch(() => ({}));
    } else {
      r = await api("/api/bot/docs", "POST", { kind: add.kind, url: add.url, title: name, category: add.category, channelIds: add.channelIds, brandId: add.brandId });
    }
    if (!r.ok) return setAdd({ ...add, busy: false, err: r.error ?? "Không thêm được" });
    setAdd(null);
    const j2 = await api("/api/bot");
    if (j2.settings) { apply(j2); await attachNew(add.attach, j2); }
  }
  // Tài liệu thêm từ trang của một chatbot thì gắn luôn vào chatbot đó (các tài liệu mới so với trước khi thêm)
  async function attachNew(botId: string | undefined, j: View) {
    if (!botId || !v) return;
    const b = j.bots.find((x) => x.id === botId) ?? v.bots.find((x) => x.id === botId);
    if (!b) return;
    const before = new Set(v.settings.docs.map((d) => d.id));
    const fresh = j.settings.docs.map((d) => d.id).filter((id) => !before.has(id));
    if (fresh.length) await attachDocs(b, [...new Set([...b.docIds, ...fresh])]);
  }
  // Lưu danh sách tài liệu ngay (thêm, sửa, xóa đều lưu liền, không có nút Lưu riêng)
  async function saveDocs(next: Doc[]) {
    const j = await api("/api/bot", "PUT", { docs: next.map((d) => ({ id: d.id, title: d.title, body: d.body, category: d.category, channelIds: d.channelIds, brandId: d.brandId })), paused, dailyCap: cap.trim() === "" ? null : Number(cap) });
    if (j.ok) apply(j);
    return j;
  }
  async function saveEd() {
    if (!ed) return;
    if (!ed.title.trim()) return setEd({ ...ed, err: "Nhập tên tài liệu" });
    if (!ed.body.trim()) return setEd({ ...ed, err: "Nội dung không được trống" });
    const j = await saveDocs(docs.map((x, k) => (k === ed.i ? { ...x, title: ed.title, body: ed.body, category: ed.category || undefined, channelIds: ed.channelIds, brandId: ed.brandId || undefined } : x)));
    if (!j.ok) return setEd({ ...ed, err: j.error ?? "Không lưu được" });
    setEd(null);
  }
  async function removeDoc(i: number) {
    if (!confirm(`Xóa tài liệu "${docs[i].title}"?`)) return;
    await saveDocs(docs.filter((_, k) => k !== i));
  }
  const brandName = (id?: string) => (id === SHARED ? "Dùng chung" : v?.brands.find((b) => b.id === id)?.name);
  const brandOfCh = (cid: string) => v?.brands.find((b) => b.channelIds.includes(cid));
  async function saveBr() {
    if (!br) return;
    if (!br.name.trim()) return setBr({ ...br, tab: "info", err: "Nhập tên thương hiệu" });
    setBr({ ...br, busy: true, err: "", ok: "" });
    const r = await api("/api/bot/brands", "POST", { id: br.id, name: br.name, kind: br.kind, website: br.website, note: br.note, channelIds: br.channelIds, profile: br.profile });
    if (!r.ok) return setBr({ ...br, busy: false, err: r.error ?? "Không lưu được" });
    const saved = r.brand as Brand;
    await load();
    setBr({ ...brOpen(saved), tab: br.tab, ok: "Đã lưu. Mọi KP AIbot của thương hiệu này dùng hồ sơ mới ngay." });
  }
  async function removeBr(b: Brand) {
    if (!confirm(`Xóa thương hiệu "${b.name}"?`)) return;
    setMsg(null);
    const r = await api("/api/bot/brands", "DELETE", { id: b.id });
    if (!r.ok) setMsg({ ok: false, s: r.error ?? "Không xóa được" });
    await load();
  }
  const brandSelect = (value: string, onChange: (v: string) => void, opts: { shared?: boolean; none?: string } = {}) => (
    <select className="kcb-in" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{opts.none ?? "Chưa gắn thương hiệu"}</option>
      {opts.shared && <option value={SHARED}>Dùng chung (mọi thương hiệu)</option>}
      {v?.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select>
  );
  async function saveSc() {
    if (!sc) return;
    if (!sc.title.trim()) return setSc({ ...sc, err: "Nhập tên kịch bản" });
    if (!sc.body.trim()) return setSc({ ...sc, err: "Nhập nội dung kịch bản" });
    setSc({ ...sc, busy: true, err: "" });
    const r = await api("/api/bot/scripts", "POST", { id: sc.id, lib: sc.lib, title: sc.title, when: sc.when, body: sc.body, botId: sc.botId, from: sc.from });
    if (!r.ok) return setSc({ ...sc, busy: false, err: r.error ?? "Không lưu được" });
    setSc(null);
    await load();
  }
  async function removeSc(s: Script) {
    if (!confirm(`Xóa kịch bản "${s.title}"?`)) return;
    const r = await api("/api/bot/scripts", "DELETE", { id: s.id });
    if (!r.ok) setMsg({ ok: false, s: r.error ?? "Không xóa được" });
    await load();
  }
  const snippet = (w: WebChat) => `<script src="${v?.base ?? ""}/api/web/widget.js?key=${w.key}" async></script>`;
  async function copySnippet(w: WebChat) {
    try { await navigator.clipboard.writeText(snippet(w)); setCopied(w.id); setTimeout(() => setCopied(""), 2000); } catch { setCopied(""); }
  }
  async function submitWc() {
    if (!wc) return;
    setWc({ ...wc, busy: true, err: "" });
    const r = await api("/api/bot/webchat", "POST", { id: wc.id, name: wc.name, title: wc.title, greeting: wc.greeting, color: wc.color, origins: wc.origins, position: wc.position });
    if (!r.ok) return setWc({ ...wc, busy: false, err: r.error ?? "Không lưu được" });
    if (wc.attachBot) {
      const b = v?.bots.find((x) => x.id === wc.attachBot);
      if (b) {
        const a = await api("/api/bot/bots", "POST", { ...b, channelIds: [...b.channelIds, r.id] });
        if (!a.ok) return setWc({ ...wc, busy: false, err: a.error ?? "Không gắn được vào chatbot" });
      }
    }
    const bot = wc.attachBot;
    setWc(null);
    await load();
    if (bot) setEmbed(bot);
  }
  async function refreshDoc(id: string) {
    setMsg(null);
    const r = await api("/api/bot/docs/refresh", "POST", { id });
    setMsg(r.ok ? { ok: true, s: "Đã lấy lại nội dung." } : { ok: false, s: r.error ?? "Không làm mới được" });
    if (r.ok) await load();
  }
  async function toggleAuto(id: string, auto: boolean) {
    setMsg(null);
    const r = await api("/api/bot/docs/auto", "POST", { id, auto });
    setMsg(r.ok ? { ok: true, s: auto ? "Đã bật tự làm mới: khi có tin khách và bản chép cũ hơn 6 giờ, hệ thống lấy lại nội dung." : "Đã tắt tự làm mới." } : { ok: false, s: r.error ?? "Không đổi được" });
    if (r.ok) await load();
  }
  const touch = () => { setDirty(true); setMsg(null); };
  const total = docs.reduce((s, d) => s + d.body.length, 0);
  const libScripts = v.scripts.filter((s) => !s.botId); // mẫu có sẵn (chỉ để sao sang chatbot); kịch bản riêng của chatbot có botId
  const pageBot = openId && openId !== "new" ? v.bots.find((b) => b.id === openId) : undefined;
  const pageOpen = openId === "new" || !!pageBot;
  const formDirty = !!form && (openId === "new" || (!!pageBot && JSON.stringify(form) !== JSON.stringify(formOf(pageBot))));
  // Tài liệu hợp với kênh của chatbot (gợi ý cho kênh đó hoặc cho mọi kênh) hiện trước
  const suggested = (d: { channelIds?: string[] }) => !d.channelIds?.length || (form?.channelIds ?? []).some((c) => d.channelIds?.includes(c));
  const sortedDocs = v.settings.docs.map((d, i) => ({ d, i })).sort((a, b) => Number(suggested(b.d)) - Number(suggested(a.d)) || a.i - b.i).map(({ d }) => d);
  const zaloP = form ? form.channelIds.some((id) => v.channels.find((c) => c.id === id)?.kind === "zalo_personal") : false;

  const saveBar = (
    <div className="kcp-foot">
      <button className="btn cta" onClick={saveGeneral} disabled={!dirty}>Lưu</button>
      {msg && <span className="kcp-msg" style={{ color: msg.ok ? "var(--ok)" : "var(--bad)" }}>{msg.s}</span>}
      {dirty && !msg && <span className="kcp-msg">Có thay đổi chưa lưu.</span>}
    </div>
  );

  // ---------- Trang riêng của một chatbot ----------
  const renderDoc = (d: Doc, i: number, forBot?: BotCfg & { stats: Stats }) => {
    const used = !!forBot && !!d.id && forBot.docIds.includes(d.id);
    const ok = !forBot || allowedDoc(d.brandId, forBot.brandId);
    return (
      <div key={d.id ?? `n${i}`} className={`kcb-doc ${forBot && !used ? "off" : ""}`}>
        <div className="kcb-top">
          <span className="kcb-dico"><Ic n="note" /></span>
          <div className="kcb-name"><b>{d.title}</b>
            <small>{d.source?.url ?? d.source?.fileName ?? "Nhập tay"} · {d.body.length.toLocaleString("vi-VN")} ký tự{d.at ? ` · cập nhật ${new Date(d.at).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}{d.source?.truncated ? " · đã cắt bớt cho vừa giới hạn" : ""}</small>
            {d.source?.auto && <small>Tự làm mới (mỗi 6 giờ khi có tin khách){d.source.checkedAt ? ` · kiểm tra lúc ${new Date(d.source.checkedAt).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}</small>}
            {d.source?.issue && <small style={{ color: "var(--bad)" }}>{d.source.issue}</small>}
          </div>
          <div className="kcb-ac">
            {forBot && d.id && <label className="kcb-use" title={ok ? undefined : d.brandId ? "Tài liệu của thương hiệu khác" : "Tài liệu chưa gắn thương hiệu: gắn ở Kiến thức chung trước"}><input type="checkbox" checked={used} disabled={!ok && !used} onChange={(e) => attachDocs(forBot, e.target.checked ? [...forBot.docIds, d.id as string] : forBot.docIds.filter((x) => x !== d.id))} /> Dùng cho chatbot này</label>}
            <button className="btn" onClick={() => setEd({ i, title: d.title, category: d.category ?? "", channelIds: d.channelIds ?? [], brandId: d.brandId ?? "", body: d.body, err: "" })}>Sửa</button>
            {d.id && (d.source?.type === "web" || d.source?.type === "drive") && <button className="btn" onClick={() => refreshDoc(d.id as string)}>Làm mới</button>}
            {d.id && (d.source?.type === "web" || d.source?.type === "drive") && <button className="btn" title="Tự lấy lại nội dung từ link khi bản chép cũ hơn 6 giờ" onClick={() => toggleAuto(d.id as string, !d.source?.auto)}>{d.source?.auto ? "Tắt tự làm mới" : "Tự làm mới"}</button>}
            {!forBot && <button className="btn kcb-del" aria-label={`Xóa tài liệu ${d.title}`} title="Xóa tài liệu" onClick={() => removeDoc(i)}><Ic n="trash" /></button>}
          </div>
        </div>
        <div className="kcb-tags kcb-line">
          {v.brands.length > 0 && <i className={`kcb-tag ${d.brandId ? "" : "nobrand"}`}>{d.brandId ? brandName(d.brandId) ?? "(thương hiệu đã xóa)" : "Chưa gắn thương hiệu"}</i>}
          {!ok && <i className="kcb-tag nobrand">Không dùng được cho chatbot này</i>}
          <i className="kcb-tag type">{SRC.find(([k]) => k === srcOf(d))?.[1]}</i>
          {d.category && <i className="kcb-tag">{d.category}</i>}
          {d.channelIds?.length
            ? d.channelIds.map((id) => { const c = v.channels.find((x) => x.id === id); return <i key={id} className="kcb-tag chan"><em style={{ background: COLOR[c?.kind ?? ""] ?? "var(--mute)" }} />{c?.name ?? "(kênh đã gỡ)"}</i>; })
            : <i className="kcb-tag chan">Mọi kênh</i>}
        </div>
      </div>
    );
  };

  const brandPage = br ? (() => {
    const saved = !!br.id;
    const fields = fieldsOf(br.kind);
    const dirty = brOrigOf(br) !== br.orig;
    const filled = filledCount(br.kind, br.profile);
    const mine = saved ? v.bots.filter((x) => x.brandId === br.id) : [];
    const set = (p: Partial<BrForm>) => setBr({ ...br, ...p, err: "", ok: "" });
    const closeBr = () => { if (dirty && !confirm("Bỏ các thay đổi chưa lưu ở thương hiệu này?")) return; setBr(null); };
    return (
      <div className="bp">
        <div className="bp-bar">
          <button className="bp-back" onClick={closeBr}><span aria-hidden="true">←</span> KP AIbot</button>
          <span className="bp-sep" aria-hidden="true">›</span>
          <span className="bp-sep">Thương hiệu</span>
          <span className="bp-sep" aria-hidden="true">›</span>
          <input className="bp-name" style={{ width: `${Math.min(48, Math.max(16, br.name.length + 2))}ch` }} maxLength={60} value={br.name} placeholder="Tên thương hiệu" aria-label="Tên thương hiệu" onChange={(e) => set({ name: e.target.value })} />
          <span className="bp-st" role="status">{br.err ? <span className="bad">{br.err}</span> : dirty ? <span className="warn">Có thay đổi chưa lưu</span> : br.ok ? <span className="ok">{br.ok}</span> : null}</span>
          <div className="bp-acts">
            {dirty && saved && <button className="btn" onClick={() => setBr({ ...brOpen(v.brands.find((x) => x.id === br.id)), tab: br.tab })}>Bỏ thay đổi</button>}
            <button className="btn cta bp-save" disabled={br.busy || (saved && !dirty)} onClick={saveBr}>{saved ? "Lưu" : "Tạo thương hiệu"}</button>
          </div>
        </div>
        <section className="bp-card bp-main bp-brand">
          <nav className="bp-tabs" role="tablist" aria-label="Các mục của thương hiệu">
            <button role="tab" aria-selected={br.tab === "profile"} className={br.tab === "profile" ? "on" : ""} onClick={() => set({ tab: "profile" })}><Ic n="note" /> Hồ sơ ({filled}/{fields.length})</button>
            <button role="tab" aria-selected={br.tab === "info"} className={br.tab === "info" ? "on" : ""} onClick={() => set({ tab: "info" })}><Ic n="tag" /> Thông tin và kênh</button>
          </nav>
          <div className="bp-body">
            {br.tab === "profile" && (
              <>
                <div className="bp-sh">
                  <div><b>Hồ sơ thương hiệu</b><small>Điền một lần, mọi KP AIbot của {br.name.trim() || "thương hiệu này"} dùng ngay, không phải sửa từng chatbot. Mục để trống thì chatbot nói sẽ kiểm tra lại và chuyển nhân viên, không tự bịa.{saved && mine.length ? ` Đang dùng cho: ${mine.map((x) => x.name).join(", ")}.` : ""}</small></div>
                </div>
                <div className="kcb-segs" role="tablist" aria-label="Loại thương hiệu">
                  {BRAND_KINDS.map(([k, name]) => <button key={k} type="button" role="tab" aria-selected={br.kind === k} className={br.kind === k ? "on" : ""} onClick={() => set({ kind: k })}>{name}</button>)}
                </div>
                <div className="bp-fields">
                  {fields.map((f) => {
                    const val = br.profile[f.key] ?? "";
                    const has = !!val.trim();
                    return (
                      <div key={f.key} className={`bp-fld ${has ? "ok" : ""}`}>
                        <div className="bp-fh"><b>{f.label}</b><span className={`bp-dot ${has ? "ok" : "no"}`}>{has ? "Đã có" : "Chưa có"}</span></div>
                        <small>{f.hint}</small>
                        <textarea className="bp-ta" rows={4} maxLength={PROFILE_LIMITS.field} value={val} aria-label={f.label} placeholder={`Ví dụ: ${f.example}`} onChange={(e) => set({ profile: { ...br.profile, [f.key]: e.target.value } })} />
                        <span className="bp-cnt">{val.length.toLocaleString("vi-VN")}/{PROFILE_LIMITS.field.toLocaleString("vi-VN")}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            {br.tab === "info" && (
              <>
                <div className="bp-cap">Thông tin</div>
                <div className="bp-row"><div className="bp-l"><b>Website</b><small>Không bắt buộc</small></div><div className="bp-c"><input className="kcb-in" maxLength={200} value={br.website} placeholder="Ví dụ: xuxifruit.com" onChange={(e) => set({ website: e.target.value })} /></div></div>
                <div className="bp-row"><div className="bp-l"><b>Ghi chú</b><small>Không bắt buộc</small></div><div className="bp-c"><input className="kcb-in" maxLength={300} value={br.note} placeholder="Ví dụ: quà tặng trái cây, trái cây cắt sẵn" onChange={(e) => set({ note: e.target.value })} /></div></div>
                <div className="bp-cap">Kênh của thương hiệu</div>
                <div className="bp-row"><div className="bp-l"><b>Kênh</b><small>Mỗi kênh chỉ thuộc một thương hiệu</small></div>
                  <div className="bp-c"><div className="kcb-chips">{v.channels.map((c) => {
                    const other = v.brands.find((b) => b.id !== br.id && b.channelIds.includes(c.id));
                    const on = br.channelIds.includes(c.id);
                    return <button key={c.id} type="button" className={on ? "on" : ""} disabled={!!other} title={other ? `Đã thuộc ${other.name}` : `${c.name} · ${KIND[c.kind] ?? c.kind}`} onClick={() => set({ channelIds: toggle(br.channelIds, c.id) })}>{on ? "✓ " : ""}{c.name}{other ? <small> · {other.name}</small> : null}</button>;
                  })}</div></div></div>
              </>
            )}
          </div>
        </section>
      </div>
    );
  })() : null;

  const pageView = pageOpen && form ? (() => {
    const saved = !!pageBot;
    const mine = pageBot ? v.scripts.filter((x) => x.botId === pageBot.id) : [];
    const used = mine.reduce((n, x) => n + x.title.length + x.when.length + x.body.length + 14, 0);
    const lib = libScripts;
    const docsSorted = pageBot ? [...docs].map((d, i) => ({ d, i })).sort((a, b) => Number(pageBot.docIds.includes(b.d.id ?? "")) - Number(pageBot.docIds.includes(a.d.id ?? "")) || Number(allowedDoc(b.d.brandId, pageBot.brandId)) - Number(allowedDoc(a.d.brandId, pageBot.brandId)) || a.i - b.i) : [];
    const brandSel = form.brandId ? v.brands.find((b) => b.id === form.brandId) : undefined;
    const tabs: [PageTab, string, "bolt" | "note" | "chat" | "wrench" | "chart" | "clip"][] = [
      ["inst", "Nhiệm vụ", "bolt"], ["conf", "Thiết lập", "wrench"], ["kb", `Kiến thức (${form.docIds.length})`, "note"],
      ["script", `Kịch bản${pageBot ? ` (${mine.length})` : ""}`, "chat"], ["eval", "Đánh giá", "chart"], ["log", "Lịch sử", "clip"],
    ];
    const tab: PageTab = !saved && pageTab !== "inst" && pageTab !== "conf" ? "inst" : pageTab;
    const row = (label: string, hint: string | null, control: React.ReactNode) => (
      <div className="bp-row"><div className="bp-l"><b>{label}</b>{hint && <small>{hint}</small>}</div><div className="bp-c">{control}</div></div>
    );
    const status = formErr ? <span className="bad">{formErr}</span> : saved && formDirty ? <span className="warn">Có thay đổi chưa lưu</span> : formOk ? <span className="ok">{formOk}</span> : null;
    return (
      <div className="bp">
        <div className="bp-bar">
          <button className="bp-back" onClick={() => closePage()}><span aria-hidden="true">←</span> KP AIbot</button>
          <span className="bp-sep" aria-hidden="true">›</span>
          <input className="bp-name" style={{ width: `${Math.min(48, Math.max(12, form.name.length + 2))}ch` }} maxLength={LIM.name} value={form.name} placeholder="Tên chatbot mới" aria-label="Tên chatbot" title="Bấm để đổi tên chatbot" onChange={(e) => setF({ name: e.target.value })} />
          {saved && (
            <button type="button" role="switch" aria-checked={pageBot.mode !== "off"} className={`kcb-sw bp-state ${pageBot.mode !== "off" ? "on" : ""}`} title={pageBot.mode === "off" ? "Chatbot đang tạm tắt. Bấm để bật lại (soạn nháp cho nhân viên). Đổi chế độ khác ở tab Thiết lập" : "Bấm để tạm tắt chatbot"} onClick={() => setMode(pageBot, pageBot.mode === "off" ? "draft" : "off")}><i /><span>{pageBot.mode === "off" ? "Tạm tắt" : MODE_NAME[pageBot.mode]}</span></button>
          )}
          <span className="bp-st" role="status">{status}</span>
          <div className="bp-acts">
            {saved && formDirty && <button className="btn" onClick={() => { setForm(formOf(pageBot)); setFormErr(""); setFormOk(""); }}>Bỏ thay đổi</button>}
            {saved && <button className="btn" title="Lấy mã nhúng khung chat vào website" onClick={() => setEmbed(pageBot.id)}>Mã nhúng</button>}
            <button className="btn cta bp-save" onClick={saveForm} disabled={saved && !formDirty}>{saved ? "Lưu" : "Tạo chatbot"}</button>
          </div>
        </div>

        <div className="bp-grid">
          <section className="bp-card bp-main">
            <div className="bp-tabrow">
            <nav className="bp-tabs" role="tablist" aria-label="Các mục của chatbot">
              {tabs.map(([k, t, ic]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} disabled={!saved && k !== "inst" && k !== "conf"} title={!saved && k !== "inst" && k !== "conf" ? "Tạo chatbot trước" : undefined} onClick={() => setPageTab(k)}><Ic n={ic} /> {t}</button>)}
            </nav>
              <label className="bp-model" title="Mô hình trả lời"><span aria-hidden="true">✦</span>
                <select value={form.model} aria-label="Mô hình" onChange={(e) => setF({ model: e.target.value })}>{v.models.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
              </label>
            </div>

            <div className="bp-body">
              {tab === "inst" && (
                <>
                  <div className="bp-sec">
                    <div className="bp-h"><b>Giọng điệu</b></div>
                    <div className="kcb-chips">{v.tones.map((t) => <button key={t} type="button" className={form.tone === t ? "on" : ""} onClick={() => setF({ tone: t })}>{t}</button>)}</div>
                    <input className="kcb-in" maxLength={LIM.tone} value={form.tone} placeholder="Chọn gợi ý ở trên hoặc tự viết" aria-label="Giọng điệu" onChange={(e) => setF({ tone: e.target.value })} />
                  </div>
                  <div className="bp-sec">
                    {!form.adviceInline && (
                      <div className="kcp-note" style={{ display: "flex", flexDirection: "column", gap: 8 }}><b>Chatbot còn dùng một đoạn hướng dẫn tư vấn có sẵn chưa hiện ra ở đây</b><span>Đoạn này dặn cách {typeOf(form.stages) === "new" ? "tư vấn khách mới (chốt sale)" : "chăm sóc khách cũ"}, đang nằm ẩn trong hệ thống. Chép ra ô dưới để thấy và sửa; từ đó chatbot chỉ dùng những gì nằm trong ô này.</span>
                        <button type="button" className="btn" style={{ alignSelf: "flex-start" }} onClick={() => setF({ instructions: `${v.adviceTemplates[typeOf(form.stages)]}${form.instructions.trim() ? `\n\n${form.instructions}` : ""}`.slice(0, LIM.instructions), adviceInline: true })}>Hiện ra để sửa</button></div>
                    )}
                    {form.adviceInline && !form.instructions.trim() && (
                      <div className="bp-sa"><span className="bp-help">Bắt đầu từ mẫu:</span>
                        <button type="button" className="btn" onClick={() => setF({ instructions: v.adviceTemplates.new })}>Chốt sale (khách mới)</button>
                        <button type="button" className="btn" onClick={() => setF({ instructions: v.adviceTemplates.care })}>Chăm sóc khách cũ</button>
                      </div>
                    )}
                    <div className="bp-h"><b>Nhiệm vụ và quy tắc</b><span>{form.instructions.length.toLocaleString("vi-VN")}/{LIM.instructions.toLocaleString("vi-VN")}</span></div>
                    <textarea className="bp-ta" rows={13} maxLength={LIM.instructions} value={form.instructions} aria-label="Nhiệm vụ và quy tắc" placeholder={"Dặn chatbot cần làm gì, mỗi dòng một ý. Ví dụ:\nBạn là nhân viên tư vấn quà tặng trái cây của cửa hàng.\nMục tiêu: hỏi dịp tặng và ngân sách, gợi ý 2 giỏ quà, xin số điện thoại.\nMỗi tin tối đa 3 câu.\nKhông báo giá khi khách chưa nói nhu cầu."} onChange={(e) => setF({ instructions: e.target.value })} />
                    <p className="bp-help">Thêm vào hướng dẫn chung của hệ thống. Chatbot luôn tuân thủ các luật cứng (không bịa giá, chuyển người khi khách khiếu nại hoặc đòi gặp người). Sửa xong thử ngay ở ô Xem thử bên phải.</p>
                  </div>
                </>
              )}

              {tab === "conf" && (
                <>
                  <div className="bp-cap">Thiết lập chung</div>
                  {row("Thương hiệu", v.brands.length ? "Chatbot chỉ dùng kênh và tài liệu của thương hiệu này hoặc tài liệu Dùng chung. Gắn rồi thì không đổi được" : null, v.brands.length === 0
                    ? <p className="bp-help">Chưa có thương hiệu. Tạo ở mục Thương hiệu (trang KP AIbot chung), gắn kênh cho từng thương hiệu.</p>
                    : pageBot?.brandId
                      ? <p className="bp-lock"><b>{brandName(pageBot.brandId) ?? "(đã xóa)"}</b> <small>đã khóa</small></p>
                      : brandSelect(form.brandId, (id) => { const b = v.brands.find((x) => x.id === id); setF({ brandId: id, channelIds: b ? form.channelIds.filter((c) => b.channelIds.includes(c)) : form.channelIds, docIds: form.docIds.filter((d) => allowedDoc(docs.find((x) => x.id === d)?.brandId, id || undefined)) }); }, { none: "Chọn thương hiệu" }))}
                  {row("Chế độ", MODES.find(([m]) => m === form.mode)?.[2] ?? null, (
                    <div className="kcb-segs" role="tablist" aria-label="Chế độ chatbot">
                      {MODES.map(([m, t]) => {
                        const blocked = m === "auto" && zaloP;
                        return <button key={m} type="button" role="tab" aria-selected={form.mode === m} disabled={blocked} className={`${form.mode === m ? "on" : ""} ${m === "auto" ? "warn" : ""}`} title={blocked ? "Zalo cá nhân là cách nối không chính thức (dễ bị khoá số): chatbot không tự gửi ở kênh này" : undefined} onClick={() => setF({ mode: m })}>{t}</button>;
                      })}
                    </div>
                  ))}
                  {zaloP && <p className="bp-warn">Có kênh Zalo cá nhân: ở đó chatbot chỉ được soạn nháp, không tự gửi.</p>}
                  {row("Kênh áp dụng", v.channels.length === 0 ? "Chưa có kênh. Thêm ở Cài đặt > Kết nối kênh." : null, (
                    <>
                      <div className="kcb-chans compact">
                        {v.channels.map((c) => {
                          const on = form.channelIds.includes(c.id);
                          return (
                            <button key={c.id} type="button" title={`${c.name} · ${KIND[c.kind]}${c.sendEnabled ? "" : " · tắt gửi tin"}`} className={`kcb-chan ${on ? "on" : ""}`} disabled={!!brandSel && !brandSel.channelIds.includes(c.id) && !on} onClick={() => setF({ channelIds: toggle(form.channelIds, c.id) })}>
                              <span className="kcb-dot" style={{ background: COLOR[c.kind] ?? "var(--mute)" }}>{(KIND[c.kind] ?? "?")[0]}</span>
                              <span className="kcb-cn"><b>{c.name}</b>{!c.sendEnabled && <small>tắt gửi tin</small>}</span>
                              <span className="kcb-tick" aria-hidden="true">{on ? "✓" : ""}</span>
                            </button>
                          );
                        })}
                      </div>
                      {form.channelIds.some((id) => v.channels.find((c) => c.id === id && !c.sendEnabled)) && <p className="bp-warn">Kênh đang tắt gửi tin thì chatbot chưa soạn ở kênh đó. Bật gửi tin ở Cài đặt &gt; Kết nối kênh.</p>}
                    </>
                  ))}
                  {row("Giai đoạn CRM phụ trách", "Chatbot trả lời khách đang ở các giai đoạn này", (
                    <>
                      <div className="kcb-stages" role="group" aria-label="Giai đoạn khách do chatbot phụ trách">
                        {STAGES.map((st) => (
                          <label key={st.key} className={form.stages.includes(st.key) ? "on" : ""}><input type="checkbox" checked={form.stages.includes(st.key)} onChange={(e) => setF({ stages: e.target.checked ? [...form.stages, st.key] : form.stages.filter((k) => k !== st.key) })} /> {st.name}</label>
                        ))}
                      </div>
                      <details className="bp-more"><summary>Cách chatbot được chọn theo giai đoạn</summary>
                        <p className="bp-help">Đổi giai đoạn ở dòng Lead CRM (cột phải của hộp thư): khách mới do chatbot chốt sale, khi chuyển sang Chuyển đổi thì giao cho chatbot chăm sóc. Mỗi giai đoạn ở một kênh chỉ do một chatbot phụ trách. Khách chưa có giai đoạn thì chọn theo thời gian: hội thoại bắt đầu trong 7 ngày gần đây là khách mới, cũ hơn là khách cũ quay lại.</p>
                      </details>
                    </>
                  ))}
                  {row("Mô tả ngắn", "Không bắt buộc", <input className="kcb-in" maxLength={LIM.description} value={form.description} aria-label="Mô tả ngắn" placeholder="Ví dụ: Tư vấn trên page Xuxi Fruit chính" onChange={(e) => setF({ description: e.target.value })} />)}
                  {row("Dùng Mẫu trả lời", "Thư viện Mẫu trả lời làm nguồn giọng văn", <button type="button" role="switch" aria-checked={form.useTemplates} className={`kcb-sw ${form.useTemplates ? "on" : ""}`} onClick={() => setF({ useTemplates: !form.useTemplates })}><i /><span>{form.useTemplates ? "Đang dùng" : "Không dùng"}</span></button>)}
                  {form.mode === "auto" && <div className="bp-cap">Khi tự trả lời</div>}
                  {form.mode === "auto" && row("Câu tự giới thiệu", "Thêm vào tin đầu tiên chatbot tự gửi; để trống thì không thêm", <input className="kcb-in" maxLength={LIM.intro} value={form.intro} aria-label="Câu tự giới thiệu" onChange={(e) => setF({ intro: e.target.value })} />)}
                  {form.mode === "auto" && row("Câu khi chuyển người", "Gửi cho khách lúc cần nhân viên; để trống thì chatbot im và chỉ gắn nhãn", <input className="kcb-in" maxLength={LIM.handoff} value={form.handoffMsg} aria-label="Câu khi chuyển người" placeholder="Ví dụ: Dạ em đã chuyển tin nhắn cho nhân viên hỗ trợ mình ạ." onChange={(e) => setF({ handoffMsg: e.target.value })} />)}
                  {saved && <div className="bp-cap bad">Vùng nguy hiểm</div>}
                  {saved && row("Xóa chatbot", "Kịch bản riêng của chatbot này cũng bị xóa. Các nháp cũ vẫn giữ trong thống kê.", <button type="button" className="btn kcb-del bp-delbtn" onClick={() => remove(pageBot)}><Ic n="trash" /> Xóa chatbot này</button>)}
                </>
              )}

              {saved && tab === "kb" && (
                <>
                  <div className="bp-sh">
                    <div><b>Tài liệu kiến thức ({pageBot.docIds.length}/{docs.length})</b><small>Tích tài liệu để chatbot đọc khi trả lời. Thêm từ đây sẽ tự gắn vào chatbot này. Tài liệu nằm trong kho chung nên dùng được cho nhiều chatbot.</small></div>
                    <div className="bp-sa">
                      {pageBot.channelIds.length > 0 && <button type="button" className="btn" onClick={() => attachDocs(pageBot, [...new Set([...pageBot.docIds, ...docs.filter((d) => d.id && allowedDoc(d.brandId, pageBot.brandId) && (!d.channelIds?.length || pageBot.channelIds.some((c) => d.channelIds?.includes(c)))).map((d) => d.id as string)])])}>Chọn gợi ý theo kênh</button>}
                      <button type="button" className="btn cta" disabled={docs.length >= LIM.docs} onClick={() => setAdd({ ...blankAdd(pageBot.brandId ?? ""), attach: pageBot.id })}><Ic n="plus" /> Thêm tài liệu</button>
                    </div>
                  </div>
                  {msg && <span className="kcp-msg" style={{ color: msg.ok ? "var(--ok)" : "var(--bad)" }}>{msg.s}</span>}
                  {docs.length === 0 && <div className="bp-empty"><b>Chưa có tài liệu nào</b><small>Thêm tệp, link web hoặc Google Drive để chatbot trả lời đúng.</small></div>}
                  <div className="kcp-list">{docsSorted.map(({ d, i }) => renderDoc(d, i, pageBot))}</div>
                </>
              )}

              {saved && tab === "script" && (
                <>
                  <div className="bp-sh">
                    <div><b>Kịch bản riêng ({mine.length}/{SC_PER_BOT})</b><small>Đưa vào lời nhắc để chatbot tư vấn đúng cách bạn muốn. Khoảng {used.toLocaleString("vi-VN")}/{SC_PROMPT.toLocaleString("vi-VN")} ký tự{used > SC_PROMPT ? ", quá giới hạn: kịch bản ở cuối danh sách bị bỏ" : ""}. Sao từ mẫu có sẵn rồi sửa riêng cho chatbot này.</small></div>
                    <div className="bp-sa">
                      <button type="button" className="btn" onClick={() => setPickSc(!pickSc)}>{pickSc ? "Đóng mẫu có sẵn" : "Thêm từ mẫu có sẵn"}</button>
                      <button type="button" className="btn cta" disabled={mine.length >= SC_PER_BOT} onClick={() => setSc({ botId: pageBot.id, lib: pageBot.type === "care" ? "care" : "sale", title: "", when: "", body: "", err: "", busy: false })}><Ic n="plus" /> Viết kịch bản</button>
                    </div>
                  </div>
                  {msg && !msg.ok && <span className="kcp-msg" style={{ color: "var(--bad)" }}>{msg.s}</span>}
                  {pickSc && (
                    <div className="kcb-pick">
                      {v.scriptLibs.map(([k, name]) => (
                        <div key={k}>
                          <b>{name}</b>
                          {lib.filter((x) => x.lib === k).map((x) => {
                            const has = mine.some((m) => m.from === x.id || (m.lib === x.lib && m.title.toLowerCase() === x.title.toLowerCase()));
                            return (
                              <div key={x.id} className="row">
                                <div><b>{x.title}</b>{x.when && <small>{x.when}</small>}</div>
                                <button className="btn" disabled={has || mine.length >= SC_PER_BOT} onClick={async () => { setMsg(null); const r = await api("/api/bot/scripts", "POST", { botId: pageBot.id, from: x.id, lib: x.lib, title: x.title, when: x.when, body: x.body }); if (!r.ok) setMsg({ ok: false, s: r.error ?? "Không thêm được" }); await load(); }}>{has ? "Đã có" : "Dùng"}</button>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                      {lib.length === 0 && <span className="kv">Không còn mẫu có sẵn nào.</span>}
                    </div>
                  )}
                  {mine.length === 0 && !pickSc && <div className="bp-empty"><b>Chưa có kịch bản riêng</b><small>Chatbot đang tư vấn theo hướng dẫn chung. Bấm Thêm từ mẫu có sẵn để bắt đầu.</small></div>}
                  <div className="kcp-list">
                    {mine.map((x) => (
                      <div key={x.id} className="kcb-doc">
                        <div className="kcb-top">
                          <span className="kcb-dico"><Ic n="note" /></span>
                          <div className="kcb-name"><b>{x.title}</b>{x.when && <small>{x.when}</small>}</div>
                          <div className="kcb-ac">
                            <button className="btn" onClick={() => setSc({ id: x.id, botId: x.botId, lib: x.lib, title: x.title, when: x.when, body: x.body, err: "", busy: false })}>Sửa</button>
                            <button className="btn kcb-del" aria-label={`Xóa kịch bản ${x.title}`} title="Xóa kịch bản" onClick={() => removeSc(x)}><Ic n="trash" /></button>
                          </div>
                        </div>
                        <pre className="kcb-sc">{x.body}</pre>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {saved && tab === "eval" && <BotEvalPanel bots={v.bots.map((b) => ({ id: b.id, name: b.name }))} botId={pageBot.id} />}
              {saved && tab === "log" && <BotHistory botId={pageBot.id} stats={pageBot.stats} outcome={v.outcomes?.[pageBot.id]} />}
            </div>
          </section>
          <BotPreview botId={pageBot?.id} form={form} resetKey={pageBot?.id ?? "new"} />
        </div>
      </div>
    );
  })() : null;

  return (
    <div className="kc-libpage">
      {pageOpen && !form && <div className="kv">Đang tải...</div>}
      {pageView}
      {brandPage}
      {!pageOpen && !br && (
      <>
      <div className="kc-libhead">
        <div className="kc-mt">
          <button className={sub === "bot" ? "on" : ""} onClick={() => setSub("bot")}><Ic n="chat" /> KP AIbot{v.bots.length ? ` (${v.bots.length})` : ""}</button>
          <button className={sub === "brand" ? "on" : ""} onClick={() => setSub("brand")}><Ic n="tag" /> Thương hiệu{v.brands.length ? ` (${v.brands.length})` : ""}</button>
          <button className={sub === "kb" ? "on" : ""} onClick={() => setSub("kb")}><Ic n="note" /> Kiến thức chung{docs.length ? ` (${docs.length})` : ""}</button>
          <button className={sub === "log" ? "on" : ""} onClick={() => setSub("log")}><Ic n="chart" /> Lịch sử</button>
        </div>
        {sub === "bot" && <button className="btn cta" style={{ marginLeft: "auto" }} onClick={newPage}><Ic n="plus" /> Thêm chatbot</button>}
        {sub === "brand" && <button className="btn cta" style={{ marginLeft: "auto" }} onClick={() => setBr(brOpen())}><Ic n="plus" /> Thêm thương hiệu</button>}
      </div>

      {sub === "bot" && (
        <div className="kcp">
          {!v.provider.ready && <div className="kcp-note">Chưa có khóa mô hình nên chatbot chưa soạn được. Nhập khóa API Anthropic ở <b>Cài đặt &gt; Khóa AI</b> (hoặc đặt biến <code>ANTHROPIC_API_KEY</code> cho máy chủ). Khóa không bao giờ hiện trên trang.</div>}
          {v.provider.id === "mock" && <div className="kcp-note">Đang dùng <b>bản giả</b> của mô hình (để thử giao diện): nháp là câu cố định, không phải do Claude soạn.</div>}
          {paused && <div className="kcp-note">Đang <b>tạm dừng</b> mọi chatbot (nút tắt khẩn bên dưới).</div>}
          {v.bots.length === 0 && <div className="kcp-note">Chưa có chatbot nào. Bấm <b>Thêm chatbot</b> để tạo: chọn loại (tư vấn khách mới hoặc chăm sóc khách cũ), kênh, chế độ và quy tắc.</div>}
          <div className="kcp-card" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: "10px 24px" }}>
            <label className="kc-sw2"><input type="checkbox" checked={paused} onChange={(e) => { setPaused(e.target.checked); touch(); }} /> Tạm dừng mọi chatbot</label>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 400 }}>Tối đa nháp / 24 giờ
              <input type="number" min={1} max={1000} value={cap} placeholder="Không giới hạn" style={{ width: 150 }} onChange={(e) => { setCap(e.target.value); touch(); }} />
            </label>
            <button className="btn cta" onClick={saveGeneral} disabled={!dirty}>Lưu</button>
            {msg && <span className="kcp-msg" style={{ color: msg.ok ? "var(--ok)" : "var(--bad)" }}>{msg.s}</span>}
          </div>
          <div className="kcp-list">
            {v.bots.map((b) => (
              <div key={b.id} className={`kcb-card mode-${b.mode}`}>
                <div className="kcb-top">
                  <span className="kcb-ava">{b.name.trim().charAt(0).toUpperCase() || "?"}</span>
                  <div className="kcb-name"><b style={{ cursor: "pointer" }} onClick={() => openPage(b)}>{b.name}</b>{b.description && <small>{b.description}</small>}</div>
                  <div className="kcb-ac">
                    <button className="btn" title="Lấy mã nhúng khung chat vào website" onClick={() => setEmbed(b.id)}>Mã nhúng</button>
                    <button className="btn" title="Mở trang riêng của chatbot: cài đặt, kiến thức, kịch bản, đánh giá, lịch sử" onClick={() => openPage(b)}>Mở</button>
                    <button className="btn" onClick={() => setMode(b, b.mode === "off" ? "draft" : "off")}>{b.mode === "off" ? "Bật lại" : "Tạm tắt"}</button>
                    <button className="btn kcb-del" aria-label={`Xóa chatbot ${b.name}`} title="Xóa chatbot" onClick={() => remove(b)}><Ic n="trash" /></button>
                  </div>
                </div>
                <div className="kcb-tags kcb-line">
                  {b.brandId && <i className="kcb-tag">{brandName(b.brandId) ?? "(thương hiệu đã xóa)"}</i>}
                  <i className="kcb-tag type">{v.types.find(([t]) => t === b.type)?.[1]}</i>
                  <i className={`kcb-tag mode-${b.mode}`}>{MODE_NAME[b.mode]}</i>
                  {b.channelIds.map((id) => { const c = v.channels.find((x) => x.id === id); return <i key={id} className="kcb-tag chan"><em style={{ background: COLOR[c?.kind ?? ""] ?? "var(--mute)" }} />{c?.name ?? "(kênh đã gỡ)"}</i>; })}
                </div>
                <div className="kcb-st">
                  {([["24 giờ", b.stats.last24h], ["Tự gửi", b.stats.auto], ["Dùng nguyên văn", b.stats.used], ["Đưa vào sửa", b.stats.edited], ["Bỏ", b.stats.discarded], ["Chuyển người", b.stats.handoff], ["Lỗi", b.stats.errors]] as [string, number][]).map(([l, n]) => <span key={l} className={n ? "has" : ""}>{l} <b>{n}</b></span>)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {sub === "brand" && (() => {
        const free = v.channels.filter((c) => !brandOfCh(c.id));
        return (
          <div className="kcp">
            <p className="bp-help">Mỗi kênh thuộc đúng một thương hiệu. Chatbot của thương hiệu nào chỉ dùng kênh và tài liệu của thương hiệu đó, cộng tài liệu Dùng chung, để chatbot không bao giờ trả lời bằng giá hay chính sách của thương hiệu khác. Hội thoại mới được gắn thương hiệu của kênh.</p>
            {msg && !msg.ok && <span className="kcp-msg" style={{ color: "var(--bad)" }}>{msg.s}</span>}
            {v.brands.length === 0 && <div className="bp-empty"><b>Chưa có thương hiệu</b><small>Thêm thương hiệu (ví dụ Xuxi Fruit, Labanfood, La Bàn Travel) rồi gắn kênh. Chatbot hiện có vẫn chạy như cũ cho tới khi được gắn thương hiệu.</small></div>}
            {free.length > 0 && v.brands.length > 0 && <div className="kcp-note">Kênh chưa thuộc thương hiệu nào: {free.map((c) => c.name).join(", ")}.</div>}
            <div className="kcp-list">
              {v.brands.map((b) => (
                <div key={b.id} className="kcb-doc">
                  <div className="kcb-top">
                    <span className="kcb-dico"><Ic n="tag" /></span>
                    <div className="kcb-name"><b>{b.name}</b>{(b.website || b.note) && <small>{[b.website, b.note].filter(Boolean).join(" · ")}</small>}</div>
                    <div className="kcb-ac">
                      <button className="btn" onClick={() => setBr(brOpen(b))}>Mở</button>
                      <button className="btn kcb-del" aria-label={`Xóa thương hiệu ${b.name}`} title="Xóa thương hiệu" onClick={() => removeBr(b)}><Ic n="trash" /></button>
                    </div>
                  </div>
                  <div className="kcb-tags kcb-line">
                    {b.channelIds.length === 0 && <i className="kcb-tag nobrand">Chưa gắn kênh</i>}
                    {b.channelIds.map((id) => { const c = v.channels.find((x) => x.id === id); return <i key={id} className="kcb-tag chan"><em style={{ background: COLOR[c?.kind ?? ""] ?? "var(--mute)" }} />{c?.name ?? "(kênh đã gỡ)"}</i>; })}
                    <i className={`kcb-tag ${filledCount(b.kind, b.profile) < fieldsOf(b.kind).length ? "nobrand" : ""}`}>Hồ sơ {filledCount(b.kind, b.profile)}/{fieldsOf(b.kind).length} mục</i>
                    <i className="kcb-tag">{v.bots.filter((x) => x.brandId === b.id).length} chatbot</i>
                    <i className="kcb-tag">{docs.filter((d) => d.brandId === b.id).length} tài liệu riêng</i>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {sub === "kb" && (
        <div className="kcp">
          <p className="bp-help">Kho tài liệu dùng chung cho mọi chatbot. Mỗi chatbot tích chọn tài liệu cần dùng ở tab Kiến thức trong trang của chatbot đó.</p>
          <div className="kcb-kbh">
            <span className="kv">{docs.length}/{LIM.docs} tài liệu, {total.toLocaleString("vi-VN")} ký tự</span>
            <button type="button" className="btn cta" disabled={docs.length >= LIM.docs} onClick={() => setAdd(blankAdd())}><Ic n="plus" /> Thêm tài liệu</button>
          </div>
          {docs.length === 0 && <div className="kcp-note">Chưa có tài liệu.</div>}
          {msg && <span className="kcp-msg" style={{ color: msg.ok ? "var(--ok)" : "var(--bad)" }}>{msg.s}</span>}
          <div className="kcp-list">
            {docs.map((d, i) => renderDoc(d, i))}
          </div>
        </div>
      )}

      {sub === "log" && (
        <div className="kcp">
          <div className="kcp-card">
            <header><div className="kcp-t"><b>Kết quả chung</b><small>Tất cả chatbot cộng lại</small></div></header>
            <div className="kcp-kpis">
              <div><span>Nháp trong 24 giờ</span><b>{v.stats.last24h}</b></div>
              <div><span>Chatbot tự gửi</span><b>{v.stats.auto}</b></div>
              <div><span>Dùng nguyên văn</span><b>{v.stats.used}</b></div>
              <div><span>Đưa vào sửa</span><b>{v.stats.edited}</b></div>
              <div><span>Bỏ</span><b>{v.stats.discarded}</b></div>
              <div><span>Đang chờ duyệt</span><b>{v.stats.pending}</b></div>
              <div><span>Đề nghị chuyển người</span><b>{v.stats.handoff}</b></div>
              <div><span>Soạn âm thầm</span><b>{v.stats.shadow}</b></div>
              <div><span>Lỗi gọi mô hình</span><b>{v.stats.errors}</b></div>
              <div><span>Token vào / ra</span><b>{v.stats.tokensIn.toLocaleString("vi-VN")} / {v.stats.tokensOut.toLocaleString("vi-VN")}</b></div>
            </div>
          </div>
          {v.bots.length > 0 && (
            <div className="tw m rt">
              <table>
                <thead><tr><th>Chatbot</th><th>Chế độ</th><th className="r">24 giờ</th><th className="r">Tự gửi</th><th className="r">Dùng nguyên văn</th><th className="r">Đưa vào sửa</th><th className="r">Bỏ</th><th className="r">Chuyển người</th><th className="r">Lỗi</th><th className="r" title="Số cuộc chat chatbot có soạn trong 30 ngày">Cuộc chat 30 ngày</th><th className="r" title="Cuộc chat khách để lại số điện thoại, tính từ lúc chatbot vào cuộc">Có SĐT</th><th className="r" title="Cuộc chat chatbot chuyển hoặc đề nghị chuyển người">Chuyển người</th></tr></thead>
                <tbody>{v.bots.map((b) => {
                  const o = v.outcomes?.[b.id];
                  return (
                    <tr key={b.id}><td><b>{b.name}</b></td><td>{MODE_NAME[b.mode]}</td><td className="r">{b.stats.last24h}</td><td className="r">{b.stats.auto}</td><td className="r">{b.stats.used}</td><td className="r">{b.stats.edited}</td><td className="r">{b.stats.discarded}</td><td className="r">{b.stats.handoff}</td><td className="r">{b.stats.errors}</td><td className="r">{o?.convs ?? 0}</td><td className="r">{o ? `${o.withPhone} (${o.phoneRate}%)` : "0"}</td><td className="r">{o ? `${o.handoffs} (${o.handoffRate}%)` : "0"}</td></tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      </>
      )}

      {embed && (() => {
        const b = v.bots.find((x) => x.id === embed);
        if (!b) return null;
        const webs = v.webchats.filter((w) => b.channelIds.includes(w.id));
        const local = /^https?:\/\/(localhost|127\.|192\.168\.|10\.)/.test(v.base);
        return (
          <Modal wide title={`Mã nhúng: ${b.name}`} onClose={() => setEmbed(null)} footer={<button className="btn" onClick={() => setEmbed(null)}>Đóng</button>}>
            <div className="kcb">
              {webs.length === 0 && (
                <section>
                  <p className="kcb-hint">Chatbot này chưa gắn với khung chat trên web. Tạo một khung chat (một website một khung) để lấy mã nhúng. Khách chat trên web sẽ vào hộp thư KP Chat như các kênh khác, chatbot trả lời theo chế độ và quy tắc của nó.</p>
                  <button type="button" className="btn cta" style={{ alignSelf: "flex-start" }} onClick={() => setWc({ name: `${b.name} - Web`, title: "", greeting: "", color: "#1E3A8A", origins: "", position: "right", err: "", busy: false, attachBot: b.id })}>Tạo khung chat web và gắn vào chatbot</button>
                </section>
              )}
              {webs.map((w) => (
                <section key={w.id}>
                  <h5>{w.name}</h5>
                  <p className="kcb-hint">Dán đoạn mã vào trang web, ngay trước thẻ <code>&lt;/body&gt;</code>. Với KP Shop: KPF &gt; KP Shop &gt; Cài đặt &gt; Popup liên hệ &gt; Khung chat trên web, dán mã vào rồi bật công tắc. Khung chat tự lấy tên và ngôn ngữ (vi, en, ko, zh, ru) từ trang nếu trang có khai.</p>
                  <pre className="kcb-code">{snippet(w)}</pre>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" className="btn cta" onClick={() => copySnippet(w)}>{copied === w.id ? "Đã sao chép" : "Sao chép mã"}</button>
                    <button type="button" className="btn" onClick={() => setWc({ id: w.id, name: w.name, title: w.title, greeting: w.greeting, color: w.color, origins: w.origins, position: w.position, err: "", busy: false })}>Cấu hình khung chat</button>
                  </div>
                  <p className="kcb-hint">Website được phép: {w.origins ? w.origins.split("\n").join(", ") : "mọi website (nên khai website của anh trong Cấu hình để người khác không dùng chung được mã)"}.</p>
                </section>
              ))}
              {webs.length > 0 && local && <p className="kcb-hint warn">Địa chỉ trong mã đang là <b>{v.base}</b>, chỉ chạy trên máy này. Muốn nhúng vào website thật cần địa chỉ công khai HTTPS của KP Chat (đặt biến KPCHAT_PUBLIC_URL hoặc dùng đường hầm), rồi sao chép lại mã.</p>}
              {webs.length > 0 && b.mode === "off" && <p className="kcb-hint warn">Chatbot đang tạm tắt: khách vẫn nhắn được nhưng chatbot không trả lời, chỉ nhân viên trả lời.</p>}
            </div>
          </Modal>
        );
      })()}

      {wc && (
        <Modal title={wc.id ? "Cấu hình khung chat web" : "Tạo khung chat web"} onClose={() => setWc(null)}
          footer={<><span className="kcb-err">{wc.err}</span><button className="btn" onClick={() => setWc(null)}>Hủy</button><button className="btn cta" disabled={wc.busy} onClick={submitWc}>{wc.busy ? "Đang lưu..." : wc.id ? "Lưu" : "Tạo"}</button></>}>
          <div className="kcb">
            <section>
              <input className="kcb-in" maxLength={80} value={wc.name} placeholder="Tên khung chat, ví dụ: Website xuxifruit.com" onChange={(e) => setWc({ ...wc, name: e.target.value, err: "" })} />
              <div className="kcb-row">
                <input className="kcb-in" maxLength={60} value={wc.title} placeholder="Tiêu đề khung chat (mặc định: Chat với shop)" onChange={(e) => setWc({ ...wc, title: e.target.value })} />
                <label className="kcb-colour">Màu <input type="color" value={wc.color} onChange={(e) => setWc({ ...wc, color: e.target.value })} /></label>
              </div>
              <div className="kcb-f"><label>Vị trí khung chat</label>
                <div className="kcb-segs" role="tablist">{([["right", "Góc phải dưới"], ["left", "Góc trái dưới"]] as ["right" | "left", string][]).map(([k, t]) => <button key={k} type="button" role="tab" aria-selected={wc.position === k} className={wc.position === k ? "on" : ""} onClick={() => setWc({ ...wc, position: k })}>{t}</button>)}</div>
              </div>
              <input className="kcb-in" maxLength={200} value={wc.greeting} placeholder="Lời chào đầu (mặc định: Xin chào! Mình có thể giúp gì cho bạn?)" onChange={(e) => setWc({ ...wc, greeting: e.target.value })} />
              <div className="kcb-f"><label>Website được phép nhúng <em>mỗi dòng một địa chỉ; để trống nghĩa là mọi website</em></label>
                <textarea className="kcb-in" rows={3} value={wc.origins} placeholder={"https://xuxifruit.com\nhttps://shop.labanfood.com"} onChange={(e) => setWc({ ...wc, origins: e.target.value })} />
              </div>
            </section>
          </div>
        </Modal>
      )}

      {sc && (
        <Modal wide title={`${sc.id ? "Sửa" : "Thêm"} kịch bản · ${sc.botId ? `riêng cho ${v.bots.find((b) => b.id === sc.botId)?.name ?? "chatbot"}` : v.scriptLibs.find(([k]) => k === sc.lib)?.[1] ?? ""}`} onClose={() => setSc(null)}
          footer={<><span className="kcb-err">{sc.err}</span><button className="btn" onClick={() => setSc(null)}>Hủy</button><button className="btn cta" disabled={sc.busy} onClick={saveSc}>{sc.busy ? "Đang lưu..." : "Lưu"}</button></>}>
          <div className="kcb">
            <section>
              <input className="kcb-in" maxLength={SC_LIM.title} value={sc.title} placeholder="Tên kịch bản, ví dụ: Khách chê đắt" onChange={(e) => setSc({ ...sc, title: e.target.value, err: "" })} />
              <div className="kcb-f"><label>Dùng khi nào <em>không bắt buộc</em></label>
                <input className="kcb-in" maxLength={SC_LIM.when} value={sc.when} placeholder="Ví dụ: Khách phản đối về giá" onChange={(e) => setSc({ ...sc, when: e.target.value })} />
              </div>
              <div className="kcb-f"><label>Nội dung <em>{sc.body.length}/{SC_LIM.body}</em></label>
                <textarea className="kcb-in" rows={12} maxLength={SC_LIM.body} value={sc.body} placeholder={"K: lời khách\nB: lời chatbot mẫu, chỗ điền theo thương hiệu để trong [ ]\n\nNguyên tắc: ..."} onChange={(e) => setSc({ ...sc, body: e.target.value, err: "" })} />
              </div>
            </section>
          </div>
        </Modal>
      )}

      {ed && (
        <Modal wide title="Sửa tài liệu" onClose={() => setEd(null)}
          footer={<><span className="kcb-err">{ed.err}</span><button className="btn" onClick={() => setEd(null)}>Hủy</button><button className="btn cta" onClick={saveEd}>Lưu</button></>}>
          <div className="kcb">
            <section>
              <input className="kcb-in" maxLength={LIM.title} value={ed.title} placeholder="Tên tài liệu" onChange={(e) => setEd({ ...ed, title: e.target.value, err: "" })} />
              <div className="kcb-f"><label>Loại tài liệu</label>
                <div className="kcb-chips">{v.docCategories.map((c) => <button key={c} type="button" className={ed.category === c ? "on" : ""} onClick={() => setEd({ ...ed, category: ed.category === c ? "" : c })}>{c}</button>)}</div>
              </div>
              {v.brands.length > 0 && <div className="kcb-f"><label>Thương hiệu <em>chatbot chỉ đọc tài liệu cùng thương hiệu hoặc Dùng chung</em></label>{brandSelect(ed.brandId, (id) => setEd({ ...ed, brandId: id, err: "" }), { shared: true })}</div>}
              <div className="kcb-f"><label>Gợi ý cho kênh <em>để trống nghĩa là mọi kênh</em></label>
                <div className="kcb-chips">{v.channels.map((c) => <button key={c.id} type="button" className={ed.channelIds.includes(c.id) ? "on" : ""} onClick={() => setEd({ ...ed, channelIds: toggle(ed.channelIds, c.id) })}>{ed.channelIds.includes(c.id) ? "✓ " : ""}{c.name}</button>)}</div>
              </div>
              <div className="kcb-f"><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><label>Nội dung <em>{ed.body.length}/{LIM.body}</em></label>
                <button type="button" className="kcb-link" title="Bỏ dòng trống thừa, dòng lặp, chữ menu, giỏ hàng, nút (Xem chi tiết, Thêm vào giỏ...)" onClick={() => setEd({ ...ed, body: tidyText(ed.body), err: "" })}>Dọn dòng thừa</button></div>
                <textarea className="kcb-in" rows={12} maxLength={LIM.body} value={ed.body} onChange={(e) => setEd({ ...ed, body: e.target.value, err: "" })} />
              </div>
            </section>
          </div>
        </Modal>
      )}

      {add && (
        <Modal wide title="Thêm tài liệu" onClose={() => setAdd(null)}
          footer={<><span className="kcb-err">{add.err}</span><button className="btn" onClick={() => setAdd(null)}>Hủy</button><button className="btn cta" disabled={add.busy} onClick={submitAdd}>{add.busy ? "Đang lấy..." : "Thêm"}</button></>}>
          <div className="kcb">
            <section>
              <h5><i>1</i> Thông tin</h5>
              <input className="kcb-in" maxLength={LIM.title} value={add.name} placeholder={add.kind === "text" ? "Tên tài liệu, ví dụ: Bảng giá trái cây cắt sẵn" : "Tên tài liệu (để trống thì tự đặt theo tên tệp hoặc trang)"} onChange={(e) => setAdd({ ...add, name: e.target.value, err: "" })} />
              <div className="kcb-f"><label>Loại tài liệu</label>
                <div className="kcb-chips">{v.docCategories.map((c) => <button key={c} type="button" className={add.category === c ? "on" : ""} onClick={() => setAdd({ ...add, category: add.category === c ? "" : c })}>{c}</button>)}</div>
              </div>
              {v.brands.length > 0 && <div className="kcb-f"><label>Thương hiệu <em>chatbot chỉ đọc tài liệu cùng thương hiệu hoặc Dùng chung</em></label>{brandSelect(add.brandId, (id) => setAdd({ ...add, brandId: id, err: "" }), { shared: true })}</div>}
              <div className="kcb-f"><label>Gợi ý cho kênh <em>để trống nghĩa là mọi kênh</em></label>
                <div className="kcb-chips">{v.channels.map((c) => <button key={c.id} type="button" className={add.channelIds.includes(c.id) ? "on" : ""} onClick={() => setAdd({ ...add, channelIds: toggle(add.channelIds, c.id) })}>{add.channelIds.includes(c.id) ? "✓ " : ""}{c.name}</button>)}</div>
              </div>
            </section>
            <section>
              <h5><i>2</i> Nội dung lấy từ</h5>
              <div className="kcb-opts four">
                {([["text", "Nhập văn bản", "Gõ hoặc dán"], ["file", "Tệp", "txt, md, csv, json, html, PDF"], ["web", "Link web", "Trang công khai"], ["drive", "Google Drive", "Docs, Sheets, tệp chia sẻ"]] as ["text" | "file" | "web" | "drive", string, string][]).map(([k, t, d]) => (
                  <button key={k} type="button" className={`kcb-opt ${add.kind === k ? "on" : ""}`} onClick={() => setAdd({ ...add, kind: k, err: "" })}><span className="kcb-radio" aria-hidden="true" /><span><b>{t}</b><small>{d}</small></span></button>
                ))}
                <button type="button" className="kcb-opt" disabled><span className="kcb-radio" aria-hidden="true" /><span><b>Sản phẩm KP</b><small>Sắp có</small></span></button>
              </div>
              {add.kind === "text" && <textarea className="kcb-in" rows={7} maxLength={LIM.body} value={add.text} placeholder="Nội dung: giá, quy cách, chính sách..." onChange={(e) => setAdd({ ...add, text: e.target.value, err: "" })} />}
              {add.kind === "file" && <input type="file" accept=".txt,.md,.markdown,.csv,.tsv,.json,.xml,.html,.htm,.pdf,text/*,application/pdf,application/json" onChange={(e) => setAdd({ ...add, file: e.target.files?.[0] ?? null, err: "" })} />}
              {(add.kind === "web" || add.kind === "drive") && <input className="kcb-in" value={add.url} placeholder={add.kind === "web" ? "https://..." : "Link Google Docs, Sheets hoặc Drive (chia sẻ: bất kỳ ai có đường liên kết)"} onChange={(e) => setAdd({ ...add, url: e.target.value, err: "" })} />}
            </section>
          </div>
        </Modal>
      )}

    </div>
  );
}
