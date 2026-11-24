"use client";
/* Mục Hội thoại: bố cục 3 cột như KP Chat 1.1 (danh sách, khung chat, hồ sơ), dùng lớp .kc-* của chat.css. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Attachment, Message, Contact, Conversation } from "@/core/types";
import type { ConvListItem } from "@/core/service";
import type { HostProfile } from "@/core/hostprofile";
import type { Template } from "@/core/store";
import { Ic, Select, usePersist } from "./ui";
import { AttachmentView, EmojiPop, Linkify, shrinkImage } from "./ChatParts";
import QuickPanel from "./QuickPanel";
import { MediaPickModal, preview, useLibrary } from "./LibraryPane";
import { staffLabel, useActor } from "./actor";
import { HUMAN_AGENT_NOTE } from "@/core/metahuman";
import { DEFAULT_LABEL_CFG, matchLabels, type LabelCfg } from "@/core/labels";
import { STAGES, stageOf } from "@/core/convmeta";
import LabelBar from "./LabelBar";
import SidePanel from "./SidePanel";
import LabelPicker from "./LabelPicker";
import ChannelPicker from "./ChannelPicker";
import { matchChannel, type ChannelGroup } from "@/core/channelgroups";
import { inRange, TIME_OPTIONS, timeRange } from "@/core/timefilter";
import { ASSISTANT_KIND, ASSISTANT_NONE, BOT_STATES, HANDOFF_LABEL, matchAssistant, matchBotState } from "@/core/botfilter";
import BotMenu, { type BotAssignLite } from "./BotMenu";
import { useNewMessageAlerts } from "./notify";

const KIND: Record<string, string> = { facebook: "Messenger", instagram: "Instagram", zalo_oa: "Zalo OA", zalo_personal: "Zalo cá nhân", web: "Web chat", tiktok: "TikTok" };
// Cửa sổ trả lời của từng kênh (giờ) kể từ tin cuối của khách
// Huy hiệu kênh trên ảnh khách: nhìn lướt biết khách đến từ đâu
const BADGE: Record<string, string> = { facebook: "M", instagram: "I", zalo_oa: "Z", zalo_personal: "Z", web: "W", tiktok: "T" };
export const MAX_PICS = 10; // số ảnh đính kèm tối đa cho một lần gửi
const WINDOW_H: Record<string, number> = { facebook: 24, instagram: 24, zalo_oa: 168, tiktok: 48 };

interface ChanLite { id: string; name: string; kind: string; sendEnabled: boolean; off: boolean }
interface Thread { conversation: Conversation; contact: Contact; channel: ChanLite; messages: Message[]; profile: HostProfile; botAssign?: BotAssignLite | null }
type Quick = "all" | "unread" | "none" | "wait" | "need";

const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 45% 45%)`; };
// Ảnh khách nếu có, lỗi hoặc hết hạn thì quay về chữ cái đầu
function Av({ name, url, sm }: { name: string; url?: string; sm?: boolean }) {
  const [bad, setBad] = useState(false);
  return (
    <span className={`kc-av${sm ? " sm" : ""}`} style={{ background: hue(name) }}>
      {url && !bad ? <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setBad(true)} /> : initials(name)}
    </span>
  );
}
const initials = (n: string) => { const w = n.trim().split(/\s+/).filter(Boolean); return (w.length > 1 ? w[0][0] + w[w.length - 1][0] : (w[0] ?? "?").slice(0, 2)).toUpperCase(); };
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "vừa xong";
  if (m < 60) return `${m} phút`;
  if (m < 1440) return `${Math.round(m / 60)} giờ`;
  return new Date(t).toLocaleDateString("vi-VN");
};
const clock = (t: number) => new Date(t).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
const dayLabel = (t: number) => new Date(t).toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
const render = (body: string, v: { ten_khach?: string; ten_nhan_vien?: string }) =>
  body.replace(/\{(ten_khach|ten_nhan_vien)\}/g, (m, k: "ten_khach" | "ten_nhan_vien") => v[k] ?? m);
const waitText = (m: number) => (m < 60 ? `${m} phút` : m < 1440 ? `${Math.floor(m / 60)} giờ` : `${Math.floor(m / 1440)} ngày`);

async function api(url: string, method = "GET", body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  return r.json().catch(() => ({}));
}

export default function ChatPane({ onUnread, onNeed, openId, onOpened, goChannels, goLibrary }: { onUnread: (n: number) => void; onNeed?: (n: number) => void; openId: string | null; onOpened: () => void; goChannels: () => void; goLibrary?: () => void }) {
  const { me, staff } = useActor();
  const admin = me.role === "admin";
  const [items, setItems] = useState<ConvListItem[]>([]);
  const [channels, setChannels] = useState<ChanLite[]>([]);
  const [humanAgent, setHumanAgent] = useState(false); // Meta Human Agent đang bật (META_HUMAN_AGENT=1): Messenger và Instagram trả lời được tới 7 ngày
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [quick, setQuick] = useState<Quick>("all");
  const [q, setQ] = useState("");
  const [fOpen, setFOpen] = useState(false);
  const [sortOld, setSortOld] = useState(false);
  const fRef = useRef<HTMLDivElement>(null);
  const [chSel, setChSel] = usePersist<string[]>("kc.chsel", []); // các kênh đang chọn (trống = tất cả kênh)
  const [chGroups, setChGroups] = useState<ChannelGroup[]>([]); // nhóm kênh của người dùng
  const [fAsg, setFAsg] = useState("all");
  const [fLabels, setFLabels] = useState<string[]>([]); // lọc theo nhiều nhãn
  const [fLabelAll, setFLabelAll] = useState(false); // false: có một trong các nhãn đã chọn; true: có đủ các nhãn
  const [fTime, setFTime] = useState("all");
  const [fBot, setFBot] = useState("all"); // KP AIbot: chatbot nào phụ trách
  const [fBotState, setFBotState] = useState("all"); // Trạng thái chatbot: phụ trách, gợi ý, cần người, tạm dừng
  const [bots, setBots] = useState<{ id: string; name: string; type: string; channelIds?: string[] }[]>([]); // các chatbot đã tạo
  const [fFrom, setFFrom] = useState(""); // Tùy chọn: từ ngày, đến ngày (yyyy-mm-dd)
  const [fTo, setFTo] = useState("");
  const [fPhone, setFPhone] = useState(false);
  const [fStage, setFStage] = useState("all");
  const [fStatus, setFStatus] = useState("open"); // trạng thái hội thoại: open = đang xử lý (chưa xong), resolved = đã xong, all = tất cả
  const [labelCfg, setLabelCfg] = useState<LabelCfg>(DEFAULT_LABEL_CFG);
  const [side, setSide] = usePersist<boolean>("kc.side", true); // cột thông tin bên phải: hiện hoặc thu gọn
  const [emo, setEmo] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "thread" | "info">("list");
  const [thread, setThread] = useState<Thread | null>(null);
  const [text, setText] = useState("");
  const [pics, setPics] = useState<Attachment[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [qp, setQp] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pend, setPend] = useState<{ conv: string; msg: Message }[]>([]); // tin vừa gửi, hiện ngay trong khung chat khi đang gửi
  const { lib, reload: reloadLib } = useLibrary();
  const [queue, setQueue] = useState<{ text: string; images: string[] }[]>([]); // các nội dung còn lại của mẫu, gửi tiếp sau nội dung đầu
  const [mediaOpen, setMediaOpen] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const drafts = useRef<Record<string, string>>({});
  const area = useRef<HTMLTextAreaElement>(null);
  const typingAt = useRef(0); // lần cuối báo "đang gõ" lên máy chủ
  const alerts = useNewMessageAlerts({ selected: sel, onOpen: (id) => choose(id) }); // âm báo và thông báo trình duyệt khi khách nhắn mới
  const checkAlerts = alerts.check;

  // Tìm kiếm và trạng thái lọc ở máy chủ (tìm trong MỌI tin, tên, số điện thoại, nhãn). Chờ gõ xong 300ms rồi mới hỏi.
  const [qq, setQq] = useState("");
  useEffect(() => { const t = setTimeout(() => setQq(q.trim().length >= 2 ? q.trim() : ""), 300); return () => clearTimeout(t); }, [q]);
  const [limit, setLimit] = useState(300); // số hội thoại tải về; "Xem thêm" tăng dần
  const [total, setTotal] = useState(0);
  const loadList = useCallback(async () => {
    const st = qq ? "all" : fStatus === "open" ? "active" : fStatus;
    // no-cache: trình duyệt hỏi lại kèm ETag, danh sách không đổi thì máy chủ trả 304 (không tải lại cả danh sách)
    const r = await fetch(`/api/inbox?status=${st}&limit=${limit}${qq ? `&q=${encodeURIComponent(qq)}` : ""}`, { cache: "no-cache" }).catch(() => null);
    const j = r?.ok ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) return;
    setTotal(j.total ?? 0);
    setItems(j.items ?? []);
    if (j.items) checkAlerts(j.items);
    setChannels(j.channels ?? []);
    setHumanAgent(!!j.humanAgent);
    setBots(j.bots ?? []);
    onUnread(j.unread ?? 0);
    onNeed?.(j.needHuman ?? 0);
    setLoaded(true);
  }, [onUnread, onNeed, checkAlerts, qq, fStatus, limit]);
  const loadThread = useCallback(async (id: string) => {
    const j = await api(`/api/inbox/${encodeURIComponent(id)}`);
    if (j.conversation) setThread(j);
  }, []);
  const loadTemplates = useCallback(async () => setTemplates((await api("/api/templates")).templates ?? []), []);
  // Nháp của chatbot (chỉ khi kênh bật chế độ nháp). Bot không tự gửi: nhân viên bấm Dùng, Sửa hoặc Bỏ.
  const [bot, setBot] = useState<{ draft: { id: string; kind: "reply" | "handoff"; text: string; note?: string; reason?: string; asked?: boolean } | null; enabled: boolean; shadow?: { kind: "reply" | "handoff"; text: string; note?: string; reason?: string } | null; status?: { kind: "none" | "bot" | "draft" | "paused" | "handoff"; text: string; canTake?: boolean; canBack?: boolean } }>({ draft: null, enabled: false });
  const [botBusy, setBotBusy] = useState(false);
  const loadDraft = useCallback(async (id: string) => { const j = await api(`/api/inbox/${encodeURIComponent(id)}/draft`); setBot({ draft: j.draft ?? null, enabled: !!j.enabled, status: j.status, shadow: j.shadow ?? null }); }, []);

  useEffect(() => {
    loadList();
    // Tab đang ẩn vẫn hỏi (thưa hơn, 15 giây) để còn báo tin mới; tab hiện thì 5 giây
    let tick = 0;
    const t = setInterval(() => { tick++; if (!document.hidden || tick % 3 === 0) loadList(); }, 5000);
    const back = () => { if (!document.hidden) loadList(); };
    document.addEventListener("visibilitychange", back);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", back); };
  }, [loadList]);
  useEffect(() => {
    if (!fOpen) return;
    const down = (e: MouseEvent) => { if (fRef.current && !fRef.current.contains(e.target as Node)) setFOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setFOpen(false); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [fOpen]);
  useEffect(() => { loadTemplates(); }, [loadTemplates]);
  useEffect(() => { api("/api/channel-groups").then((j) => { if (j.groups) setChGroups(j.groups); }).catch(() => {}); }, []);
  // Lưu nhóm kênh của mình; trả về lời báo lỗi (trống là thành công)
  async function saveChGroups(next: ChannelGroup[]): Promise<string> {
    const j = await api("/api/channel-groups", "PUT", { groups: next });
    if (!j.ok) return j.error ?? "Không lưu được nhóm";
    setChGroups(j.groups);
    return "";
  }
  useEffect(() => { fetch("/api/labels", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (j.cfg) setLabelCfg(j.cfg); }).catch(() => {}); }, [sel]);
  useEffect(() => { if (openId) { choose(openId); onOpened(); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [openId]);

  useEffect(() => { if (sel) fetch(`/api/inbox/${encodeURIComponent(sel)}/open`, { method: "POST" }).catch(() => {}); }, [sel]); // ghi Nhật ký: mở hội thoại (một lần mỗi lần chọn)
  useEffect(() => {
    if (!sel) { setThread(null); return; }
    loadThread(sel);
    const t = setInterval(() => { if (!document.hidden) loadThread(sel); }, 4000);
    return () => clearInterval(t);
  }, [sel, loadThread]);

  useEffect(() => {
    if (!sel) { setBot({ draft: null, enabled: false }); return; }
    loadDraft(sel);
    const t = setInterval(() => { if (!document.hidden) loadDraft(sel); }, 4000);
    return () => clearInterval(t);
  }, [sel, loadDraft]);

  const lastIn = thread?.conversation.lastInboundAt ?? 0;
  useEffect(() => {
    if (!sel || !lastIn) return;
    api(`/api/inbox/${encodeURIComponent(sel)}/read`, "POST").then(loadList);
  }, [sel, lastIn, loadList]);

  const nMsgs = thread?.messages.filter((m) => !m.internal).length ?? 0;
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [nMsgs, sel]);

  function choose(id: string) {
    if (sel) drafts.current[sel] = text; // nhớ nháp của hội thoại đang mở
    setSel(id);
    setText(drafts.current[id] ?? "");
    setPics([]);
    setErr("");
    setQp(false);
    setPend([]);
    setView("thread");
    setTimeout(() => area.current?.focus(), 50);
  }

  const now = Date.now();
  const fChans = useMemo(() => chSel.filter((id) => channels.some((c) => c.id === id)), [chSel, channels]); // bỏ kênh đã xóa hoặc không còn quyền
  // Bộ lọc Phụ trách và KP AIbot chỉ liệt kê giá trị của các kênh đang chọn (không chọn kênh nào thì tất cả)
  const botsHere = useMemo(() => bots.filter((b) => fChans.length === 0 || (b.channelIds ?? []).some((c) => fChans.includes(c))), [bots, fChans]);
  const staffHere = useMemo(() => {
    if (fChans.length === 0) return staff;
    const ids = new Set(items.filter((i) => fChans.includes(i.channel.id) && i.assigneeUid).map((i) => i.assigneeUid));
    return staff.filter((s) => ids.has(s.uid) || s.uid === me.uid);
  }, [staff, items, fChans, me.uid]);
  useEffect(() => {
    if (fBot !== "all" && fBot !== ASSISTANT_NONE && !botsHere.some((b) => b.id === fBot)) setFBot("all");
    if (fAsg.startsWith("u:") && !staffHere.some((s) => s.uid === fAsg.slice(2))) setFAsg("all");
  }, [botsHere, staffHere, fBot, fAsg]);
  const labelsAll = useMemo(() => [...new Set(items.flatMap((i) => i.labels))].filter((l) => l !== HANDOFF_LABEL).sort(), [items]);

  const range = useMemo(() => timeRange(fTime, Date.now(), { from: fFrom, to: fTo }), [fTime, fFrom, fTo]);
  // Mọi bộ lọc trừ tab nhanh; số đếm trên các tab nhanh tính trên tập này nên nhảy theo kênh, người phụ trách, nhãn, thời gian...
  const base = useMemo(() => {
    return items.filter((i) => {
      // Trạng thái và tìm kiếm đã lọc ở máy chủ (loadList)
      if (!matchChannel(i.channel.id, fChans)) return false;
      if (fAsg === "me" && i.assigneeUid !== me.uid) return false;
      if (fAsg === "none" && i.assigneeUid) return false;
      if (fAsg.startsWith("u:") && i.assigneeUid !== fAsg.slice(2)) return false;
      if (!matchLabels(i.labels, fLabels, fLabelAll)) return false;
      if (fPhone && !i.hasPhone) return false;
      if (fStage === "none" ? !!i.stage : fStage !== "all" && i.stage !== fStage) return false;
      if (!inRange(i.lastMessageAt, range)) return false;
      if (!matchAssistant(i, fBot) || !matchBotState(i, fBotState)) return false;
      return true;
    });
  }, [items, fChans, fAsg, fLabels, fLabelAll, range, fBot, fBotState, fPhone, fStage, me.uid]);
  const counts = useMemo(() => ({
    all: base.length,
    unread: base.filter((i) => i.unread).length,
    none: base.filter((i) => !i.assigneeUid).length,
    wait: base.filter((i) => i.waitingSince).length,
    need: base.filter((i) => i.needHuman).length,
  }), [base]);
  const list = useMemo(() => {
    return base.filter((i) => {
      if (quick === "unread" && !i.unread) return false;
      if (quick === "none" && i.assigneeUid) return false;
      if (quick === "wait" && !i.waitingSince) return false;
      if (quick === "need" && !i.needHuman) return false;
      return true;
    }).sort((a, b) => (sortOld ? a.lastMessageAt - b.lastMessageAt : 0));
  }, [base, quick, sortOld]);
  const nFilters = [fStatus !== "open", fAsg !== "all", fLabels.length > 0, range !== null, fBot !== "all", fBotState !== "all", fPhone, fStage !== "all"].filter(Boolean).length;

  const ch = thread?.channel;
  const metaKind = ch?.kind === "facebook" || ch?.kind === "instagram";
  const winH = ch ? (metaKind && humanAgent ? 168 : WINDOW_H[ch.kind]) : undefined;
  const leftMs = winH && thread?.conversation.lastInboundAt ? thread.conversation.lastInboundAt + winH * 3600_000 - now : null;
  const closed = leftMs !== null && leftMs <= 0;
  // Quá 24 giờ nhưng còn trong 7 ngày: gửi bằng thẻ Human Agent, nhắc nhân viên chỉ gửi nội dung hỗ trợ
  const tagged = metaKind && humanAgent && !closed && !!thread?.conversation.lastInboundAt && now - thread.conversation.lastInboundAt > 24 * 3600_000;
  const vars = { ten_khach: thread?.contact.name, ten_nhan_vien: me.name };
  const slash = /^\/\S*$/.test(text) ? text.slice(1).toLowerCase() : null;
  const picker = slash !== null ? templates.filter((t) => !slash || t.key.startsWith(slash) || preview(t).toLowerCase().includes(slash)) : []; // gõ / để chèn mẫu
  const canReply = !!ch?.sendEnabled && !closed;
  const canSend = (!!text.trim() || pics.length > 0) && canReply && slash === null && !uploading;

  const imgAtt = (ids: string[]): Attachment[] => ids.flatMap((id) => { const m = lib?.items.find((x) => x.id === id); return m ? [{ type: "image" as const, url: m.url, name: m.name }] : []; });
  // Chọn mẫu: nội dung đầu vào ô soạn (sửa được), các nội dung sau xếp hàng gửi tiếp
  const pick = (t: Template) => {
    const [first, ...rest] = t.blocks;
    setText(render(first?.text ?? "", vars));
    setPics(imgAtt(first?.images ?? []));
    setQueue(rest);
    setQp(false);
    area.current?.focus();
  };

  // Gửi: ô soạn được xóa ngay và tin hiện luôn trong khung chat (tạm, mờ); lỗi thì trả nội dung lại ô soạn để gửi lại. Mẫu nhiều nội dung gửi lần lượt.
  async function send(first?: { text: string; pics: Attachment[] }) {
    const head = first ?? { text, pics };
    if (!sel || busy || !canReply || (!head.text.trim() && head.pics.length === 0) || (!first && slash !== null) || uploading) return;
    const conv0 = sel;
    // Zalo cá nhân chỉ nhận tối đa 5 ảnh mỗi lần: nhiều hơn thì tách thành các tin liên tiếp (chữ đi cùng tin đầu)
    const per = ch?.kind === "zalo_personal" ? 5 : MAX_PICS;
    type Item = { text: string; atts: Attachment[]; blk?: { text: string; images: string[] } };
    const split = (b: Item): Item[] => (b.atts.length <= per ? [b] : Array.from({ length: Math.ceil(b.atts.length / per) }, (_, i) => ({ text: i ? "" : b.text, atts: b.atts.slice(i * per, (i + 1) * per), blk: i ? undefined : b.blk })));
    const seq: Item[] = [{ text: head.text, atts: head.pics } as Item, ...queue.map((b): Item => ({ text: render(b.text, vars), atts: imgAtt(b.images), blk: b }))].flatMap(split);
    const stamp = Date.now();
    setBusy(true); setErr(""); setText(""); setPics([]); setQueue([]); setQp(false); setEmo(false); delete drafts.current[conv0];
    setPend(seq.map((b, i) => ({ conv: conv0, msg: { id: `tmp-${stamp}-${i}`, companyId: "", conversationId: conv0, externalId: "", direction: "out", text: b.text, attachments: b.atts, at: stamp + i, senderUid: me.uid } as Message })));
    let n = 0;
    for (const b of seq) {
      if (b.text.trim() || b.atts.length) {
        const r = await api(`/api/inbox/${encodeURIComponent(conv0)}/send`, "POST", { text: b.text, attachments: b.atts });
        if (!r.ok) {
          setPend([]);
          if (sel === conv0) { setText(b.text); setPics(b.atts); setQueue(seq.slice(n + 1).flatMap((x) => (x.blk ? [x.blk] : []))); } // phần mẫu chưa gửi được xếp lại để gửi tiếp
          setErr(`${n ? `Đã gửi ${n}/${seq.length} nội dung. ` : ""}${r.error ?? "Gửi lỗi"}`);
          setBusy(false); loadThread(conv0); loadList(); return;
        }
      }
      n++;
    }
    await loadThread(conv0);
    setPend([]); setBusy(false); loadList();
  }
  // Đính kèm ảnh từ máy (chọn tệp, dán, kéo thả): ảnh được thu nhỏ rồi tải lên, tối đa MAX_PICS ảnh một lần gửi
  async function attachFiles(files: FileList | File[] | null, base?: Attachment[]) {
    const all = Array.from(files ?? []);
    if (!all.length) return;
    const list = all.filter((f) => f.type.startsWith("image/"));
    if (!list.length) return setErr("Chỉ đính kèm được ảnh (jpg, png, webp).");
    setUploading(true); setErr("");
    const out = [...(base ?? pics)];
    let e = list.length < all.length ? "Chỉ đính kèm được ảnh (jpg, png, webp)." : "";
    for (const f0 of list) {
      if (out.length >= MAX_PICS) { e = `Tối đa ${MAX_PICS} ảnh một lần gửi.`; break; }
      const f = await shrinkImage(f0);
      const fd = new FormData();
      fd.set("file", f);
      const j = await fetch("/api/media", { method: "POST", body: fd }).then((r) => r.json()).catch(() => ({ error: "Lỗi mạng" }));
      if (j.ok) out.push({ type: "image", url: j.url, name: f0.name }); else e = j.error ?? "Không tải được ảnh";
    }
    setPics(out); setUploading(false);
    if (e) setErr(e);
  }
  // Ảnh trong hộp Thư mục ảnh: nhận biết ảnh nào đang đính kèm là ảnh của thư mục để tick sẵn khi mở lại
  const libIds = pics.flatMap((p) => { const m = lib?.items.find((x) => x.url === p.url); return m ? [m.id] : []; });
  const nonLib = pics.filter((p) => !lib?.items.some((x) => x.url === p.url));
  // Tiếp quản (dừng bot, mình nhận khách) hoặc giao lại cho bot
  async function botHand(action: "takeover" | "handback") {
    if (!sel || botBusy) return;
    setBotBusy(true); setErr("");
    const j = await api(`/api/inbox/${encodeURIComponent(sel)}/bot`, "POST", { action });
    setBotBusy(false);
    if (!j.ok) setErr(j.error ?? "Không thực hiện được");
    loadDraft(sel); loadThread(sel); loadList();
  }
  // Chọn chatbot của hội thoại (menu Bot, khi kênh có từ hai chatbot)
  async function botAssign(botId: string, withStaff: boolean) {
    if (!sel) return;
    const j = await api(`/api/inbox/${encodeURIComponent(sel)}/bot`, "POST", { action: "assign", bot: botId, withStaff });
    if (!j.ok) setErr(j.error ?? "Không thực hiện được");
    loadThread(sel); loadDraft(sel); loadList();
  }
  async function botAct(action: "use" | "edit" | "discard" | "ask") {
    if (!sel || botBusy) return;
    if (action === "edit" && text.trim()) return setErr("Ô soạn đang có chữ. Gửi hoặc xóa chữ đó trước khi lấy nháp của chatbot để sửa.");
    setBotBusy(true); setErr("");
    const j = await api(`/api/inbox/${encodeURIComponent(sel)}/draft`, "POST", { action });
    setBotBusy(false);
    if (!j.ok) { setErr(j.error ?? "Không thực hiện được"); loadDraft(sel); return; }
    if (action === "edit") { setText(j.text ?? ""); setTimeout(() => area.current?.focus(), 30); }
    loadDraft(sel); loadThread(sel); loadList();
  }
  async function patch(body: object) {
    if (!sel) return;
    const j = await api(`/api/inbox/${encodeURIComponent(sel)}`, "PATCH", body);
    if (!j.ok) setErr(j.error ?? "Không thực hiện được");
    loadThread(sel); loadList();
  }
  async function toggleSend(c: ChanLite) {
    await api("/api/channels", "PATCH", { id: c.id, sendEnabled: !c.sendEnabled });
    if (sel) loadThread(sel);
    loadList();
  }

  const rows = useMemo(() => {
    const out: Array<{ k: "day"; t: number } | { k: "msg"; m: Message }> = [];
    let prev = 0;
    for (const m of [...(thread?.messages ?? []), ...pend.filter((x) => x.conv === sel).map((x) => x.msg)]) {
      if (m.internal) continue; // ghi chú nội bộ chỉ hiện ở cột hồ sơ bên phải, không chen vào khung chat
      if (!prev || !sameDay(prev, m.at)) out.push({ k: "day", t: m.at });
      out.push({ k: "msg", m });
      prev = m.at;
    }
    return out;
  }, [thread, pend, sel]);
  const notes = (thread?.messages ?? []).filter((m) => m.internal);
  const conv = thread?.conversation;
  const assignOpts: [string, string][] = [["", "Chưa nhận"], ...(admin ? staff : staff.filter((s) => s.uid === me.uid)).map((s) => [s.uid, s.name] as [string, string])];
  const winCls = leftMs === null ? "" : leftMs <= 0 ? "off" : leftMs < 2 * 3600_000 ? "soon" : "";
  // Hết hạn thì không dán nhãn đỏ ở đầu hội thoại (nhất là hội thoại cũ tải về): ô soạn tin đã báo rõ
  const winText = leftMs === null || leftMs <= 0 ? "" : `Còn ${leftMs > 48 * 3600_000 ? Math.floor(leftMs / 86400_000) + " ngày" : Math.max(1, Math.floor(leftMs / 3600_000)) + " giờ"} để trả lời`;

  return (
    <div className="kc-wrap">
      <div className={`kc-main v-${view}${side ? "" : " noside"}`}>
        {/* Cột 1: danh sách */}
        <section className="kc-col kc-list">
          <div className="kc-lh">
            {/* góc trên cột 1: tên mục và chọn kênh, đổi kênh là đổi cả danh sách */}
            <div className="kc-lt">
              <b>Hội thoại</b>
              <ChannelPicker channels={channels.filter((c) => !c.off).map((c) => ({ id: c.id, name: c.name, kind: c.kind, count: items.filter((i) => i.channel.id === c.id && i.status !== "resolved").length }))} groups={chGroups} value={fChans} onChange={setChSel} onGroups={saveChGroups} />
            </div>
            <div className="kc-search"><input type="search" placeholder="Tìm tên, số điện thoại, nội dung tin, nhãn" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <div className="kc-tabs">
              <button className={quick === "all" ? "on" : ""} onClick={() => setQuick("all")}>Tất cả<i>{counts.all}</i></button>
              {counts.need > 0 && <button className={`kc-needtab ${quick === "need" ? "on" : ""}`} title="Chatbot đã chuyển hoặc đề nghị chuyển người, chưa ai xử lý" onClick={() => setQuick("need")}>Cần người<i>{counts.need}</i></button>}
              <button className={quick === "unread" ? "on" : ""} onClick={() => setQuick("unread")}>Chưa đọc{counts.unread > 0 && <i>{counts.unread}</i>}</button>
              <button className={quick === "wait" ? "on" : ""} title="Khách nhắn mà chưa ai trả lời" onClick={() => setQuick("wait")}>Chờ{counts.wait > 0 && <i>{counts.wait}</i>}</button>
              <button className={quick === "none" ? "on" : ""} onClick={() => setQuick("none")}>Chưa nhận{counts.none > 0 && <i>{counts.none}</i>}</button>
            </div>
            <div className="kc-frow">
              <button type="button" className="kc-ft" title="Đổi thứ tự danh sách" onClick={() => setSortOld(!sortOld)}>{sortOld ? "Cũ nhất" : "Gần nhất"} ⇅</button>
              <span className="kv">{list.length} hội thoại</span>
              {alerts.perm === "default"
                ? <button type="button" className="kc-ft" title="Bật thông báo: báo khi khách nhắn mới lúc đang mở tab khác" onClick={alerts.askPermission}>🔔<span className="kc-hide-s"> Bật thông báo</span></button>
                : <button type="button" className="kc-ft" aria-pressed={alerts.pref.sound} title={alerts.pref.sound ? "Đang bật âm báo tin mới. Bấm để tắt" : "Đang tắt âm báo tin mới. Bấm để bật"} onClick={() => alerts.setSound(!alerts.pref.sound)}>{alerts.pref.sound ? "🔔" : "🔕"}</button>}
              <div className="kc-fwrap" ref={fRef}>
                <button type="button" className={`kc-fbtn${nFilters ? " on" : ""}`} aria-haspopup="dialog" aria-expanded={fOpen} onClick={() => setFOpen(!fOpen)}><svg className="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4" /></svg> Lọc{nFilters > 0 && <i>{nFilters}</i>}</button>
                {fOpen && (
                  <div className="kc-fpop" role="dialog" aria-label="Bộ lọc hội thoại">
                    <div className="kc-fg">
                      <label><span>Trạng thái</span><Select value={fStatus} options={[["open", "Đang xử lý"], ["resolved", "Đã xong"], ["all", "Tất cả"]]} onChange={setFStatus} /></label>
                      <label><span>Thời gian</span><Select value={fTime} options={TIME_OPTIONS} onChange={setFTime} /></label>
                      <label><span>Phụ trách</span><Select value={fAsg} options={[["all", "Mọi người"], ["me", "Của tôi"], ["none", "Chưa nhận"], ...(admin ? staffHere.map((s) => [`u:${s.uid}`, s.name] as [string, string]) : [])]} onChange={setFAsg} /></label>
                      {fTime === "custom" && <div className="kc-frange"><label><span>Từ ngày</span><input type="date" value={fFrom} max={fTo || undefined} onChange={(e) => setFFrom(e.target.value)} /></label><label><span>Đến ngày</span><input type="date" value={fTo} min={fFrom || undefined} onChange={(e) => setFTo(e.target.value)} /></label></div>}
                      <label><span>Giai đoạn CRM</span><Select value={fStage} options={[["all", "Tất cả"], ["none", "Chưa có giai đoạn"], ...STAGES.map((x): [string, string] => [x.key, x.name])]} onChange={setFStage} /></label>
                      <div className="kc-fl2"><span className="kc-fl2h">Nhãn</span><LabelPicker cfg={labelCfg} used={labelsAll} value={fLabels} all={fLabelAll} onChange={setFLabels} onAll={setFLabelAll} /></div>
                      <label title="Chatbot phụ trách hội thoại: mỗi giai đoạn của khách có thể có một chatbot riêng (chốt sale cho khách mới, chăm sóc cho khách đã mua)"><span>KP AIbot</span><Select value={fBot} options={[["all", "Tất cả"], ...botsHere.map((b): [string, string] => [b.id, `${b.name} · ${ASSISTANT_KIND[b.type] ?? b.type}`]), [ASSISTANT_NONE, "Chưa có chatbot"]]} onChange={setFBot} /></label>
                      <label title="Chatbot đang làm gì: phụ trách (tự trả lời), gợi ý (soạn nháp cho nhân viên), cần người hỗ trợ, hoặc tạm dừng"><span>Trạng thái chatbot</span><Select value={fBotState} options={BOT_STATES} onChange={setFBotState} /></label>
                      <label className="kc-fchk kc-fphone"><input type="checkbox" checked={fPhone} onChange={(e) => setFPhone(e.target.checked)} /> Có số điện thoại</label>
                    </div>
                    <div className="kc-fpf">
                      <button type="button" className="kc-link" disabled={nFilters === 0} onClick={() => { setFStatus("open"); setFAsg("all"); setFLabels([]); setFLabelAll(false); setFTime("all"); setFFrom(""); setFTo(""); setFBot("all"); setFBotState("all"); setFPhone(false); setFStage("all"); }}>Xóa bộ lọc</button>
                      <button type="button" className="btn cta" onClick={() => setFOpen(false)}>Xem {list.length} hội thoại</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="kc-scroll">
            {loaded && list.length === 0 && (
              <div className="kc-empty">
                {channels.length === 0
                  ? admin ? <>Chưa có kênh nào. <button className="kc-link" onClick={goChannels}>Thêm kênh để nhận tin</button>.</> : "Chưa có kênh nào. Nhờ quản trị thêm kênh."
                  : items.length === 0 ? "Chưa có hội thoại nào. Tin khách nhắn tới sẽ hiện ở đây."
                  : "Không có hội thoại nào khớp bộ lọc."}
                {channels.length === 0 && admin && <><br /><br /><button className="btn" onClick={async () => { await api("/api/dev/seed", "POST"); loadList(); loadTemplates(); }}>Nạp dữ liệu mẫu</button></>}
              </div>
            )}
            {list.map((it) => {
              const wait = it.waitingSince ? Math.max(0, Math.round((now - it.waitingSince) / 60000)) : 0;
              return (
                <button key={it.id} className={`kc-it ${sel === it.id ? "on" : ""} ${it.unread ? "un" : ""}`} onClick={() => choose(it.id)}>
                  <span className="kc-avw"><Av name={it.contactName} url={it.contactAvatar} /><span className="kc-cb" data-k={it.channel.kind} title={KIND[it.channel.kind] ?? it.channel.kind}>{BADGE[it.channel.kind] ?? "?"}</span></span>
                  <span className="kc-bd">
                    <span className="kc-r1"><b>{it.contactName}</b><span className="kc-t">{it.lastMessageAt ? ago(it.lastMessageAt) : ""}</span></span>
                    <span className="kc-sn">{it.snippet ? <>🔎 {it.snippet}</> : <>{it.lastDirection === "out" ? "Bạn: " : ""}{it.lastText || "(đính kèm)"}</>}</span>
                    {it.needHuman && <span className="kc-nh" title={it.needHuman.auto ? "Chatbot đã dừng và chuyển người" : "Chatbot đề nghị chuyển người"}>⚠ {it.needHuman.reason}</span>}
                    <span className="kc-meta">
                      <span className="kc-pl">{KIND[it.channel.kind] ?? it.channel.kind}</span>
                      {it.needHuman && <span className={`kc-ic need ${it.needHuman.overdue ? "od" : ""}`} title={`Chatbot chuyển người lúc ${clock(it.needHuman.since)}`}>cần người · chờ {waitText(Math.max(0, Math.round((now - it.needHuman.since) / 60000)))}{it.needHuman.overdue ? " · quá hạn" : ""}</span>}
                      {it.waitingSince && <span className={`kc-ic ${it.sla?.state === "breach" ? "bad" : ""}`} title={it.sla ? `Khách đang chờ. Ngưỡng SLA ${it.sla.limitMin} phút` : "Khách đang chờ được trả lời (kênh chưa cài SLA)"}>chờ {waitText(wait)}{it.sla?.state === "breach" ? " · vượt SLA" : ""}</span>}
                      {it.sla?.state === "soon" && <span className="kc-as" title={`Sắp vượt ngưỡng SLA ${it.sla.limitMin} phút`}>sắp vượt SLA</span>}
                      {it.status === "resolved" && <span className="kc-ic mute">đã xong</span>}
                      {it.stage && <span className={`kc-ic st-${stageOf(it.stage)?.core ?? "new"}`} title="Giai đoạn CRM">{stageOf(it.stage)?.name}</span>}
                      {it.labels.filter((l) => l !== HANDOFF_LABEL).slice(0, 2).map((l) => <span key={l} className="kc-tag" style={labelCfg.labels[l] ? { background: labelCfg.labels[l].color, color: "#fff" } : { background: "#E5E7EB" }}>{l}</span>)}
                      {it.bot && it.bot.state !== "paused" && <span className={`kc-bchip${it.bot.mode === "draft" ? " dr" : ""}`} title={it.bot.mode === "draft" ? `${it.bot.name} soạn nháp, nhân viên duyệt` : `${it.bot.name} đang trả lời${it.bot.withStaff ? " cùng nhân viên" : ""}`}>{it.bot.mode === "draft" ? "Chatbot nháp" : "Chatbot"}</span>}
                      {it.assigneeUid ? <span className="kc-as" style={{ background: "var(--navy-s)", color: "var(--navy)" }} title="Người phụ trách">{it.assigneeUid === me.uid ? "Của tôi" : staffLabel(staff, it.assigneeUid)}</span> : <span className="kc-as">Chưa nhận</span>}
                    </span>
                  </span>
                  {it.unread && <span className="kc-dot" />}
                </button>
              );
            })}
            {total > items.length && (
              <div className="kc-more">
                <span className="kv">Đang hiện {items.length}/{total} hội thoại gần nhất</span>
                <button type="button" className="btn" onClick={() => setLimit((l) => l + 300)}>Xem thêm</button>
              </div>
            )}
          </div>
        </section>

        {/* Cột 2: khung chat */}
        <section className="kc-col kc-thread">
          {!thread || !ch || !conv ? (
            <div className="kc-empty">{sel ? "Đang mở hội thoại..." : "Chọn một hội thoại bên trái."}</div>
          ) : (
            <>
              <div className="kc-head">
                <button className="kc-back" onClick={() => { setView("list"); setSel(null); }} aria-label="Về danh sách">‹</button>
                <Av name={thread.contact.name} url={thread.contact.avatarUrl} sm />
                <div className="kc-who"><b>{thread.contact.name}</b><span>{ch.name} · {KIND[ch.kind] ?? ch.kind}</span></div>
                {winText && <span className={`kc-win ${winCls}`}>{winText}</span>}
                <div className="kc-hc">
                  {!conv.assigneeUid && <button className="kc-mini" onClick={() => patch({ assigneeUid: me.uid })}>Nhận khách</button>}
                  {conv.assigneeUid && <label>Phụ trách<Select value={conv.assigneeUid} options={assignOpts} onChange={(v) => patch({ assigneeUid: v || null })} /></label>}
                  <BotMenu status={bot.status} canAsk={bot.enabled && !bot.draft} busy={botBusy}
                    onTake={() => botHand("takeover")} onBack={() => botHand("handback")} onAsk={() => botAct("ask")} />
                </div>
                <button className="kc-infob btn" onClick={() => setView("info")}>Hồ sơ</button>
                <button type="button" className={`kc-sidet${side ? " on" : ""}`} aria-pressed={side} title={side ? "Thu gọn thông tin hội thoại" : "Mở thông tin hội thoại"} aria-label={side ? "Thu gọn cột thông tin" : "Mở cột thông tin"} onClick={() => setSide(!side)}><Ic n="panel" /></button>
              </div>
              <div className="kc-msgs">
                {rows.map((r, i) =>
                  r.k === "day" ? <div key={"d" + i} className="kc-day">{dayLabel(r.t)}</div> : (
                    <div key={r.m.id} className="kc-row">
                      <div className={`kc-m ${r.m.direction === "out" && !r.m.internal ? "me" : ""} ${r.m.id.startsWith("tmp-") ? "pend" : ""}`}>
                        {r.m.attachments.map((a, k) => <AttachmentView key={k} a={a} channelId={ch.id} />)}
                        {r.m.text && <span className="kc-txt"><Linkify text={r.m.text} /></span>}
                        <span className="kc-ts">{clock(r.m.at)}{r.m.bot ? " · Chatbot" : ""}{r.m.direction === "out" && r.m.senderUid ? ` · ${r.m.senderUid === me.uid ? "Bạn" : staffLabel(staff, r.m.senderUid)}` : ""}</span>
                      </div>
                    </div>
                  )
                )}
                <div ref={bottom} />
              </div>
              <div className="kc-compose">
                {!bot.draft && bot.shadow && (
                  <div className="kc-bot shd" role="region" aria-label="Gợi ý của chatbot">
                    <div className="kc-bot-h"><b>Gợi ý của chatbot</b><span>Chỉ để tham khảo, chatbot không gửi gì cho khách.</span></div>
                    <div className="kc-bot-t">{bot.shadow.kind === "handoff" ? `Chatbot đề nghị người xử lý: ${bot.shadow.reason ?? ""}` : bot.shadow.text}</div>
                    {bot.shadow.note && <div className="kc-bot-n">Vì sao: {bot.shadow.note}</div>}
                    {bot.shadow.kind === "reply" && <div className="kc-bot-a"><button className="btn" disabled={!canReply} title={canReply ? "Chép gợi ý vào ô soạn để sửa rồi tự gửi" : "Kênh đang tắt gửi tin hoặc đã quá hạn trả lời"} onClick={() => { if (text.trim()) return setErr("Ô soạn đang có chữ. Gửi hoặc xóa chữ đó trước."); setText(bot.shadow?.text ?? ""); setTimeout(() => area.current?.focus(), 30); }}>Chép vào ô soạn</button></div>}
                  </div>
                )}
                {bot.draft && (
                  <div className={`kc-bot ${bot.draft.kind === "handoff" ? "ho" : ""}`} role="region" aria-label="Nháp của chatbot">
                    <div className="kc-bot-h"><b>{bot.draft.kind === "handoff" ? "Chatbot đề nghị người xử lý" : bot.draft.asked ? "Gợi ý của chatbot" : "Nháp của chatbot"}</b><span>{bot.draft.asked ? "Chatbot không gửi gì. Chép vào ô soạn, sửa rồi tự gửi." : "Chatbot không tự gửi. Bạn duyệt rồi mới đến khách."}</span></div>
                    {bot.draft.kind === "handoff"
                      ? <div className="kc-bot-t">{bot.draft.reason}</div>
                      : <div className="kc-bot-t">{bot.draft.text}</div>}
                    {bot.draft.note && <div className="kc-bot-n">{bot.draft.asked ? "Vì sao: " : "Ghi chú cho nhân viên: "}{bot.draft.note}</div>}
                    <div className="kc-bot-a">
                      {bot.draft.kind === "reply" && !bot.draft.asked && <button className="btn cta" disabled={botBusy || !canReply} title={canReply ? "Gửi nguyên văn cho khách (Alt+Enter)" : "Kênh đang tắt gửi tin hoặc đã quá hạn trả lời"} onClick={() => botAct("use")}>Dùng</button>}
                      {bot.draft.kind === "reply" && <button className={`btn ${bot.draft.asked ? "cta" : ""}`} disabled={botBusy} title="Đưa vào ô soạn để sửa rồi tự gửi" onClick={() => botAct("edit")}>{bot.draft.asked ? "Chép vào ô soạn" : "Sửa"}</button>}
                      {bot.draft.asked && <button className="btn" disabled={botBusy} onClick={() => botAct("ask")}>{botBusy ? "Đang soạn..." : "Gợi ý lại"}</button>}
                      <button className="btn" disabled={botBusy} onClick={() => botAct("discard")}>{bot.draft.kind === "handoff" ? "Đã xem" : bot.draft.asked ? "Đóng" : "Bỏ"}</button>
                      {bot.draft.kind === "reply" && <span className="kv kc-bot-k">Alt+Enter: {bot.draft.asked ? "chép vào ô soạn" : "dùng ngay"}</span>}
                    </div>
                  </div>
                )}
                {!ch.sendEnabled && <div className="kc-note-off">Kênh này đang tắt gửi tin, chỉ xem được. {admin ? <button className="kc-link" onClick={() => toggleSend(ch)}>Bật gửi tin</button> : "Nhờ quản trị bật gửi tin."}</div>}
                {ch.sendEnabled && closed && <div className="kc-note-off bad">Đã quá {winH && winH > 48 ? Math.round(winH / 24) + " ngày" : winH + " giờ"} kể từ tin cuối của khách: không thể nhắn thêm. Chờ khách nhắn lại.</div>}
                {ch.sendEnabled && tagged && <div className="kc-note-off">{HUMAN_AGENT_NOTE}</div>}
                {<LabelBar cfg={labelCfg} labels={conv.labels.filter((l) => l !== HANDOFF_LABEL)} canEdit={true} onChange={(next) => patch({ labels: conv.labels.includes(HANDOFF_LABEL) ? [...next, HANDOFF_LABEL] : next })} />}
                {qp && <QuickPanel templates={templates} lib={lib} admin={admin} onUse={pick} onClose={() => setQp(false)} onEdit={() => { setQp(false); goLibrary?.(); }} />}
                {picker.length > 0 && !qp && (
                  <div className="kc-qpop">
                    {picker.map((t) => <button key={t.id} type="button" onClick={() => pick(t)}><b>/{t.key}</b> {preview(t).slice(0, 70)}{t.blocks.length > 1 ? ` · ${t.blocks.length} nội dung` : ""}{t.blocks.some((b) => b.images.length) ? " · có ảnh" : ""}</button>)}
                  </div>
                )}
                {queue.length > 0 && <div className="kc-att"><span className="kv">Sẽ gửi tiếp {queue.length} nội dung theo mẫu · <button className="kc-link" onClick={() => setQueue([])}>bỏ</button></span></div>}
                {pics.length > 0 && (
                  <div className="kc-att">
                    {pics.map((p, i) => (
                      <span key={i} className="kc-ci">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={p.url} alt={p.name ?? ""} /><button type="button" title="Bỏ ảnh" aria-label="Bỏ ảnh" onClick={() => setPics(pics.filter((_, j) => j !== i))}>×</button></span>
                    ))}
                  </div>
                )}
                <div className="kc-ibox">
                  <div className="kc-itool">
                    <button type="button" className={`kc-ib ${emo ? "on" : ""}`} title="Chèn biểu tượng cảm xúc" aria-label="Biểu tượng cảm xúc" disabled={!canReply} onClick={() => { setEmo(!emo); setQp(false); }}><Ic n="smile" /></button>
                    <button type="button" className={`kc-ib ${qp ? "on" : ""}`} title="Mẫu trả lời nhanh" aria-label="Mẫu trả lời nhanh" disabled={!canReply} onClick={() => { setQp(!qp); setEmo(false); }}><Ic n="chat" /></button>
                    <button type="button" className={`kc-ib ${mediaOpen ? "on" : ""}`} title="Thư mục ảnh" aria-label="Thư mục ảnh" disabled={!canReply || !lib} onClick={() => { setQp(false); setEmo(false); setMediaOpen(true); }}><Ic n="img" /></button>
                    <button type="button" className="kc-ib" title="Đính kèm ảnh từ máy tính (jpg, png, webp; cũng dán hoặc kéo thả vào ô soạn được)" aria-label="Đính kèm ảnh từ máy tính" disabled={!canReply || uploading} onClick={() => fileRef.current?.click()}><Ic n="clip" /></button>
                    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { void attachFiles(e.target.files); e.target.value = ""; }} />
                    {uploading && <span className="kv">Đang tải ảnh...</span>}
                    {pics.length > 0 && <span className="kv">{pics.length}/{MAX_PICS} đính kèm</span>}
                    <span className="kc-err" style={{ background: "none", padding: "0 6px" }}>{err}</span>
                    {emo && <EmojiPop onClose={() => setEmo(false)} onPick={(e) => { const el = area.current; const at = el?.selectionStart ?? text.length, to = el?.selectionEnd ?? at; setText(text.slice(0, at) + e + text.slice(to)); setTimeout(() => { el?.focus(); el?.setSelectionRange(at + e.length, at + e.length); }, 0); }} />}
                  </div>
                  <div className="kc-irow">
                    <textarea
                      ref={area}
                      disabled={!canReply}
                      placeholder={canReply ? `Trả lời từ ${ch.name}. Gõ / để chèn mẫu, Enter để gửi, Shift+Enter xuống dòng` : !ch?.sendEnabled ? "Kênh đang tắt gửi tin" : "Đã quá hạn trả lời, chờ khách nhắn lại"}
                      value={text}
                      onChange={(e) => {
                        setText(e.target.value);
                        // Đang gõ ở hội thoại có chatbot: báo lên máy chủ (15 giây một lần) để chatbot chờ, không gửi chen
                        if (sel && e.target.value.trim() && bot.status && bot.status.kind !== "none" && Date.now() - typingAt.current > 15_000) { typingAt.current = Date.now(); void api(`/api/inbox/${encodeURIComponent(sel)}/typing`, "POST"); }
                      }}
                      onPaste={(e) => { const fs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/")); if (fs.length) { e.preventDefault(); void attachFiles(fs); } }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); void attachFiles(e.dataTransfer.files); } }}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") { setQp(false); setEmo(false); if (slash !== null) setText(""); return; }
                        // Alt+Enter: dùng ngay nháp của bot (hoặc chép gợi ý vào ô soạn), không cần rời bàn phím
                        if (e.key === "Enter" && e.altKey && bot.draft?.kind === "reply") { e.preventDefault(); if (bot.draft.asked) botAct("edit"); else if (canReply) botAct("use"); return; }
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          if (slash !== null) { if (picker[0]) pick(picker[0]); return; }
                          void send();
                        }
                      }}
                    />
                    <button type="button" className="kc-send ic" disabled={busy || !canSend} onClick={() => void send()} title={busy ? "Đang gửi" : "Gửi (Enter)"} aria-label="Gửi tin">{busy ? "…" : <Ic n="send" />}</button>
                  </div>
                </div>
              </div>
            </>
          )}
        </section>

        {/* Cột 3: hồ sơ */}
        <section className="kc-col kc-side">
          {!thread || !ch || !conv ? <div className="kc-empty">Hồ sơ khách hiện ở đây.</div> : (
            <>
              <button className="kc-back2" onClick={() => setView("thread")}>‹ Về hội thoại</button>
              <SidePanel conv={conv} profile={thread.profile} contact={thread.contact} messages={thread.messages} kind={KIND[ch.kind] ?? ch.kind} channelName={ch.name}
                me={me} staff={staff} admin={admin} canAct avatar={<Av name={thread.contact.name} url={thread.contact.avatarUrl} />}
                botAssign={thread.botAssign ?? null} botStatus={bot.status} onBotAssign={botAssign} onPatch={patch} onChanged={() => { loadThread(sel as string); loadList(); }} />
            </>
          )}
        </section>
      </div>
      {mediaOpen && lib && <MediaPickModal lib={lib} reload={reloadLib} max={MAX_PICS} initial={libIds} label="Chọn" onClose={() => setMediaOpen(false)}
        onDone={(ids) => { setPics([...nonLib, ...imgAtt(ids)].slice(0, MAX_PICS)); setMediaOpen(false); }}
        onLocal={(f, ids) => { setMediaOpen(false); void attachFiles(f, [...nonLib, ...imgAtt(ids)].slice(0, MAX_PICS)); }}
        onSendNow={(ids) => { setMediaOpen(false); void send({ text, pics: [...nonLib, ...imgAtt(ids)].slice(0, MAX_PICS) }); }} />}
    </div>
  );
}
