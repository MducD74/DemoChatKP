// Nhân viên duyệt nháp của bot: Dùng (gửi nguyên văn), Sửa (đưa vào ô soạn để sửa rồi tự gửi), Bỏ.
// Đây là chỗ DUY NHẤT nháp của bot thành tin gửi cho khách, và luôn đi qua sendReply bằng quyền của nhân viên bấm nút:
// kiểm quyền kênh, công tắc gửi, cửa sổ trả lời như một tin nhân viên tự gõ. chatbot.ts không có đường gửi.
import { canAct, canView } from "./policy";
import type { Actor } from "./staff";
import { sendReply } from "./service";
import { mutate, type DB, type Store } from "./store";
import { botSettings, generateDraft, livePendingDraft, pickBot, shadowDraft, type BotDraft } from "./chatbot";
import { AUTO_MAX_PER_CONV, CAP_REASON, HANDOFF_LABEL, TYPING_REASON, autoGuard, capFreeAt } from "./botauto";
import { staffName } from "./staff";
import { maybeAutoRefreshDocs } from "./botsource";

type Out = { ok: true; text?: string; draft?: BotDraft | null } | { ok: false; error: string };
const NO: Out = { ok: false, error: "Bạn không có quyền với hội thoại này" };

// Nháp đang chờ của hội thoại cho người xem (null nếu không có, hoặc người xem không có quyền với hội thoại).
export async function getLiveDraft(store: Store, convId: string, actor: Actor) {
  const db = await store.load();
  const conv = db.conversations[convId];
  const ch = conv && db.channels[conv.channelId];
  if (!conv || !ch || !canView(actor, conv, ch)) return { draft: null, enabled: false };
  const d = livePendingDraft(db, convId);
  return {
    draft: d ? { id: d.id, kind: d.kind, text: d.text, note: d.note, reason: d.reason, at: d.at, asked: !!d.asked } : null,
    // enabled: nút "Nhờ bot soạn" chỉ hiện khi kênh ở chế độ draft và người xem được phép trả lời
    status: handlerStatus(db, convId, actor, Date.now()),
    // Gợi ý tham khảo (chế độ shadow): ai xem được hội thoại đều thấy, chỉ để chép vào ô soạn, bot không gửi
    shadow: ((s) => (s ? { kind: s.kind, text: s.text, note: s.note, reason: s.reason } : null))(shadowDraft(db, convId)),
    // enabled: nút "Gợi ý tin nhắn": có chatbot gắn với kênh (kể cả đang tạm tắt) và người xem được phép trả lời
    enabled: !!pickBot(db, convId, Date.now(), { any: true }) && !botSettings(db).paused && canAct(actor, conv, ch),
  };
}

export async function askBot(store: Store, convId: string, actor: Actor): Promise<Out> {
  const db = await store.load();
  const conv = db.conversations[convId];
  const ch = conv && db.channels[conv.channelId];
  if (!conv || !ch || !canAct(actor, conv, ch)) return NO;
  await maybeAutoRefreshDocs(store);
  const r = await generateDraft(store, convId, { regenerate: true, ask: true });
  return r.ok ? { ok: true } : { ok: false, error: r.reason };
}

export async function reviewDraft(store: Store, convId: string, action: "use" | "edit" | "discard", actor: Actor): Promise<Out> {
  const db = await store.load();
  const conv = db.conversations[convId];
  const ch = conv && db.channels[conv.channelId];
  if (!conv || !ch || !canAct(actor, conv, ch)) return NO;
  const live = livePendingDraft(db, convId);
  if (!live) return { ok: false, error: "Nháp đã cũ (khách nhắn thêm hoặc đã có người trả lời) hoặc không còn" };
  const decide = (status: BotDraft["status"], from: BotDraft["status"]) =>
    mutate(store, (d) => {
      const x = d.bot?.drafts[live.id];
      if (!x || x.status !== from) return false; // người khác vừa duyệt rồi: không duyệt hai lần
      x.status = status; x.decidedAt = Date.now(); x.decidedBy = actor.uid;
      return true;
    });

  if (action === "discard") return (await decide("discarded", "pending")) ? { ok: true } : { ok: false, error: "Nháp đã được xử lý" };
  if (action === "edit") {
    if (live.kind !== "reply") return { ok: false, error: "Đây là đề nghị chuyển người, không có nội dung để sửa" };
    return (await decide("edited", "pending")) ? { ok: true, text: live.text } : { ok: false, error: "Nháp đã được xử lý" };
  }
  // Dùng: nhận phần của mình trước (tránh hai người cùng bấm gửi hai lần), gửi, lỗi thì trả nháp về chờ duyệt.
  if (live.kind !== "reply") return { ok: false, error: "Đây là đề nghị chuyển người, không có nội dung để gửi" };
  if (!(await decide("used", "pending"))) return { ok: false, error: "Nháp đã được xử lý" };
  const sent = await sendReply(store, convId, { text: live.text }, actor);
  if (!sent.ok) {
    await mutate(store, (d) => { const x = d.bot?.drafts[live.id]; if (x?.status === "used") { x.status = "pending"; x.decidedAt = undefined; x.decidedBy = undefined; } });
    return { ok: false, error: sent.error };
  }
  return { ok: true };
}

// ---------- Ai đang trả lời hội thoại: bot hay người ----------
export interface HandlerStatus {
  kind: "none" | "bot" | "draft" | "paused" | "handoff"; // paused gồm cả nhường người (nhân viên đã nhận hoặc vừa trả lời)
  text: string;
  canTake?: boolean; // hiện nút Tiếp quản (dừng bot, nhân viên nhận)
  canBack?: boolean; // hiện nút Giao lại cho bot
}
export function handlerStatus(db: DB, convId: string, actor: Actor, now: number): HandlerStatus {
  const none: HandlerStatus = { kind: "none", text: "" };
  const conv = db.conversations[convId];
  const ch = conv && db.channels[conv.channelId];
  if (!conv || !ch) return none;
  const bot = pickBot(db, convId, now);
  if (!bot || bot.mode === "off" || bot.mode === "shadow") return none;
  const can = canAct(actor, conv, ch);
  if (botSettings(db).paused) return { kind: "paused", text: "Chatbot đang tạm dừng toàn hệ thống" };
  if (conv.botCtl?.off) return { kind: "paused", text: `${staffName(conv.botCtl.by)} đã dừng chatbot ở hội thoại này`, canBack: can };
  if (bot.mode === "draft") return { kind: "draft", text: `${bot.name} soạn nháp, nhân viên duyệt trước khi gửi` };
  const hand = Object.values(db.bot?.drafts ?? {}).find((d) => d.conversationId === convId && d.status === "handed" && d.forInboundAt === conv.lastInboundAt);
  if (hand) return { kind: "handoff", text: `Chatbot chuyển người: ${hand.reason ?? "cần người xử lý"}`, canTake: can };
  const why = autoGuard(db, conv, ch, now);
  if (why === "Nhân viên đã nhận hội thoại này") return { kind: "paused", text: `${staffName(conv.assigneeUid)} đang phụ trách, chatbot không trả lời`, canBack: can };
  if (why === "Người vừa trả lời, chatbot tạm dừng") return { kind: "paused", text: "Người vừa trả lời, chatbot tạm dừng", canBack: can };
  if (why === TYPING_REASON) return { kind: "paused", text: TYPING_REASON };
  if (why === CAP_REASON) {
    const at = capFreeAt(db, conv, now);
    const when = at ? new Date(at).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : "";
    return { kind: "paused", text: `Chatbot đã trả lời ${AUTO_MAX_PER_CONV} tin cho khách này trong 24 giờ (giới hạn chống lặp).${when ? ` Tự mở lại lúc ${when}, hoặc bấm Giao lại cho bot.` : ""}`, canBack: can };
  }
  if (why) return { kind: "paused", text: `Chatbot tạm dừng: ${why.charAt(0).toLowerCase()}${why.slice(1)}` };
  const together = conv.assigneeUid && !conv.autoAssigned && conv.botSel?.withStaff ? `, cùng ${staffName(conv.assigneeUid)} phụ trách` : "";
  return { kind: "bot", text: `${bot.name} đang trả lời${together}`, canTake: can };
}

// Tiếp quản: dừng bot ở hội thoại này, nhân viên nhận khách (nếu chưa ai nhận). Bot không trả lời nữa cho đến khi giao lại.
export async function takeOver(store: Store, convId: string, actor: Actor): Promise<Out> {
  return mutate(store, (db): Out => {
    const c = db.conversations[convId];
    if (!c || !canAct(actor, c, db.channels[c.channelId])) return NO;
    const now = Date.now();
    c.botCtl = { off: true, by: actor.uid, at: now };
    if (!c.assigneeUid) { c.assigneeUid = actor.uid; c.assignedAt = now; c.autoAssigned = false; }
    c.labels = c.labels.filter((l) => l !== HANDOFF_LABEL);
    for (const d of Object.values(db.bot?.drafts ?? {})) if (d.conversationId === convId && d.status === "pending") { d.status = "stale"; d.decidedAt = now; }
    return { ok: true };
  });
}

// Giao lại cho bot: bot trả lời tiếp từ tin khách kế tiếp. Người phụ trách (nếu là người giao lại) được bỏ phụ trách để bot không bị chặn.
export async function handBack(store: Store, convId: string, actor: Actor): Promise<Out> {
  return mutate(store, (db): Out => {
    const c = db.conversations[convId];
    if (!c || !canAct(actor, c, db.channels[c.channelId])) return NO;
    const now = Date.now();
    c.botCtl = { off: false, resumeAt: now, by: actor.uid, at: now };
    if (c.assigneeUid && (c.assigneeUid === actor.uid || actor.role === "admin")) {
      c.lastAssigneeUid = c.assigneeUid; c.assigneeUid = undefined; c.assignedAt = undefined; c.autoAssigned = undefined;
    }
    return { ok: true };
  });
}
