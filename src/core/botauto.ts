// Chế độ "Tự trả lời" của chatbot: soạn xong thì gửi luôn. Đây là CHỖ DUY NHẤT bot tự gửi tin, và chỉ ở kênh quản trị đã bật chế độ này.
// Mọi lần gửi đều đi qua sendMessage nên vẫn bị chặn bởi công tắc gửi tin của kênh, cửa sổ trả lời và hạn mức số tin của kênh.
// Ngoài ra bot dừng (không soạn, không gửi) khi: Zalo cá nhân; nhân viên đã nhận hội thoại; người vừa trả lời; bot đã trả lời đủ số tin
// trong 24 giờ; khách nhắn thêm hoặc có người trả lời trong lúc bot soạn; quản trị tạm dừng. Khách xin gặp người... thì không gửi gì,
// chỉ gắn nhãn và ghi chú nội bộ để nhân viên thấy.
import { onInbound } from "./ingest";
import { sendMessage } from "./send";
import { mutate, type DB, type Store } from "./store";
import { botEligibility, generateDraft, pickBot, sortedMsgs, type BotDraft, type DraftResult } from "./chatbot";
import type { Channel, Conversation, Message } from "./types";
import { maybeAutoRefreshDocs } from "./botsource";
import { needHumanMap } from "./botqueue";
import { BOT_AUTO_SEND } from "./guardrails";

export const AUTO_MAX_PER_CONV = 8; // số tin bot tự gửi tối đa cho một hội thoại trong 24 giờ (chống vòng lặp với bot khác)
export const HUMAN_PAUSE_MS = 3600_000; // người vừa trả lời trong khoảng này thì bot tạm dừng
import { HANDOFF_LABEL } from "./botfilter";
export { HANDOFF_LABEL };
const DAY = 24 * 3600_000;

type Fail = { ok: false; reason: string };

// Luật riêng của chế độ tự trả lời. Trả lý do dừng, hoặc null nếu bot được phép.
export function autoGuard(db: DB, conv: Conversation, ch: Channel, now: number): string | null {
  if (ch.kind === "zalo_personal") return "Zalo cá nhân: chatbot không tự gửi";
  if (conv.typingAt && now - conv.typingAt < TYPING_HOLD_MS) return TYPING_REASON; // có người đang gõ dở ở ô soạn: chờ, không gửi chen
  if (conv.assigneeUid && !conv.autoAssigned && !conv.botSel?.withStaff) return "Nhân viên đã nhận hội thoại này"; // trừ khi nhân viên cho bot trả lời cùng
  const msgs = sortedMsgs(db, conv.id);
  const since = conv.botCtl?.resumeAt ?? 0; // đã giao lại cho bot thì tin người trả lời trước đó không tính
  const human = msgs.filter((m) => m.direction === "out" && !m.bot && m.at >= since).at(-1); // gồm cả tin gửi từ app ngoài KP Chat (echo)
  if (human && now - human.at < HUMAN_PAUSE_MS) return "Người vừa trả lời, chatbot tạm dừng";
  if (botRecent(msgs, since, now).length >= AUTO_MAX_PER_CONV) return CAP_REASON;
  // Đã chuyển người mà chưa ai xử lý: chatbot không trả lời chen (tránh nói ngược với nhân viên); người trả lời, Nhận hay giao lại cho chatbot thì thôi chờ
  if (needHumanMap(db, now).has(conv.id)) return WAIT_HUMAN_REASON;
  return null;
}
export const WAIT_HUMAN_REASON = "Đã chuyển cho nhân viên, chatbot chờ người xử lý";

// Nhân viên đang gõ trong ô soạn (trình duyệt báo mỗi khoảng 15 giây): chatbot chờ thêm từng này kể từ lần báo cuối
export const TYPING_HOLD_MS = 120_000;
export const TYPING_REASON = "Nhân viên đang soạn tin, chatbot chờ";
export const CAP_REASON = "Chatbot đã trả lời đủ số tin cho phép trong 24 giờ";
// Tin bot đã gửi trong 24 giờ qua, tính từ lần nhân viên giao lại cho bot (giao lại là làm mới hạn mức của hội thoại)
const botRecent = (msgs: Message[], since: number, now: number) => msgs.filter((m) => m.bot && m.at >= since && now - m.at < DAY);
// Lúc hạn mức tin của bot được mở lại (khi tin cũ nhất trong số phải chờ quá 24 giờ); null nếu chưa chạm hạn mức
export function capFreeAt(db: DB, conv: Conversation, now: number): number | null {
  const recent = botRecent(sortedMsgs(db, conv.id), conv.botCtl?.resumeAt ?? 0, now);
  return recent.length >= AUTO_MAX_PER_CONV ? recent[recent.length - AUTO_MAX_PER_CONV].at + DAY : null;
}

// Soạn rồi (nếu kênh ở chế độ tự trả lời) gửi hoặc ghi chuyển người. Chế độ nháp và bóng: chỉ soạn, giống generateDraft.
export async function runBot(store: Store, convId: string, opts: { now?: number; regenerate?: boolean } = {}): Promise<DraftResult | Fail> {
  const now = opts.now ?? Date.now();
  const db = await store.load();
  const conv = db.conversations[convId];
  const ch = conv && db.channels[conv.channelId];
  const pre = conv ? pickBot(db, convId, now) : null;
  if (conv && ch && pre?.mode === "auto") {
    const why = autoGuard(db, conv, ch, now);
    if (why) return { ok: false, reason: why };
  }
  await maybeAutoRefreshDocs(store, now); // tài liệu bật Tự làm mới và đã cũ thì lấy lại trước khi soạn
  const r = await generateDraft(store, convId, opts);
  if (!r.ok) return r;
  const bot2 = (await store.load()).bot?.bots?.[r.draft.botId ?? ""];
  if (!BOT_AUTO_SEND) return r; // ràng buộc dự án: chatbot chỉ soạn nháp, không bao giờ tự gửi
  if (bot2?.mode !== "auto" || r.draft.shadow || r.draft.status !== "pending") return r; // nháp lỗi: không có gì để gửi
  return deliver(store, r.draft, now);
}

async function deliver(store: Store, draft: BotDraft, now: number): Promise<DraftResult | Fail> {
  if (draft.kind === "handoff") {
    // Không gửi gì cho khách: gắn nhãn và ghi chú nội bộ để nhân viên thấy hội thoại này cần người
    const done = await mutate(store, (db) => {
      const d = db.bot?.drafts[draft.id];
      const c = db.conversations[draft.conversationId];
      if (!d || d.status !== "pending" || !c) return false;
      d.status = "handed"; d.decidedAt = now; d.decidedBy = "bot";
      if (!c.labels.includes(HANDOFF_LABEL)) c.labels.push(HANDOFF_LABEL);
      const mid = `note:${c.id}:${now}:bot`;
      db.messages[mid] = { id: mid, companyId: c.companyId, conversationId: c.id, externalId: mid, direction: "out", text: `Chatbot chuyển người: ${d.reason ?? "cần người xử lý"}`, attachments: [], at: now, internal: true, bot: true };
      return true;
    });
    if (!done) return { ok: false, reason: "Nháp đã được xử lý" };
    // Khách không bị im: gửi câu báo đã chuyển người nếu quản trị có đặt (cùng các kiểm tra của sendMessage)
    const db = await store.load();
    const bot = db.bot?.bots?.[draft.botId ?? ""];
    const conv = db.conversations[draft.conversationId];
    const ch = conv && db.channels[conv.channelId];
    const ct = conv && db.contacts[conv.contactId];
    if (bot?.handoffMsg && conv && ch && ct && ch.kind !== "zalo_personal") {
      const replies = sortedMsgs(db, conv.id).filter((m) => m.direction === "out" && m.at > (conv.lastInboundAt ?? 0)).length;
      const sent = await sendMessage({ channel: ch, contactExternalId: ct.externalId, conversationExternalId: conv.externalId, text: bot.handoffMsg, lastInboundAt: conv.lastInboundAt, repliesSinceInbound: replies, automated: true });
      if (sent.ok) {
        const at = Date.now();
        await mutate(store, (d) => {
          const c = d.conversations[draft.conversationId];
          if (!c) return;
          const base = `${ch.id}:${sent.externalId ?? "out-" + at}`;
          const mid = d.messages[base] ? `${base}-${at}` : base;
          d.messages[mid] = { id: mid, companyId: c.companyId, conversationId: c.id, externalId: sent.externalId ?? `out-${at}`, direction: "out", text: bot.handoffMsg as string, attachments: [], at, bot: true };
          c.lastMessageAt = Math.max(c.lastMessageAt ?? 0, at);
        });
      }
    }
    return { ok: true, draft: { ...draft, status: "handed" } };
  }

  // Nhận nháp này làm của mình và kiểm lại mọi điều kiện trên dữ liệu mới nhất ngay trước khi gửi
  const claim = await mutate(store, (db) => {
    const d = db.bot?.drafts[draft.id];
    if (!d || d.status !== "pending") return { ok: false, reason: "Nháp đã được xử lý" } as Fail;
    const no = (reason: string): Fail => { d.status = "stale"; d.decidedAt = now; return { ok: false, reason }; };
    const el = botEligibility(db, d.conversationId, now, { regenerate: true, except: d.id });
    if (!el.ok) return no(el.reason);
    if (el.bot.id !== d.botId || el.bot.mode !== "auto") return no("Chatbot không còn ở chế độ tự trả lời");
    if (el.conv.lastInboundAt !== d.forInboundAt) return no("Khách vừa nhắn thêm, bỏ nháp cũ");
    const why = autoGuard(db, el.conv, el.ch, now);
    if (why) return no(why);
    const ct = db.contacts[el.conv.contactId];
    if (!ct) return no("Không thấy khách");
    const msgs = sortedMsgs(db, el.conv.id);
    d.status = "auto"; d.decidedAt = now; d.decidedBy = "bot";
    return {
      ok: true as const, ch: el.ch, ct, conv: el.conv, intro: el.bot.intro,
      first: !msgs.some((m) => m.bot),
      replies: msgs.filter((m) => m.direction === "out" && m.at > (el.conv.lastInboundAt ?? 0)).length,
    };
  });
  if (!claim.ok) return claim;

  const text = (claim.first && claim.intro ? `${claim.intro}\n\n` : "") + draft.text;
  const sent = await sendMessage({
    channel: claim.ch, contactExternalId: claim.ct.externalId, conversationExternalId: claim.conv.externalId,
    text, lastInboundAt: claim.conv.lastInboundAt, repliesSinceInbound: claim.replies, automated: true,
  });
  const at = Date.now();
  if (!sent.ok) {
    await mutate(store, (db) => { const d = db.bot?.drafts[draft.id]; if (d) { d.status = "error"; d.reason = `Gửi lỗi: ${sent.error ?? "không rõ"}`; } });
    return { ok: false, reason: sent.error ?? "Gửi lỗi" };
  }
  await mutate(store, (db) => {
    const c = db.conversations[draft.conversationId];
    if (!c) return;
    const base = `${claim.ch.id}:${sent.externalId ?? "out-" + at}`;
    const mid = db.messages[base] ? `${base}-${at}` : base;
    db.messages[mid] = { id: mid, companyId: c.companyId, conversationId: c.id, externalId: sent.externalId ?? `out-${at}`, direction: "out", text, attachments: [], at, bot: true };
    c.lastMessageAt = Math.max(c.lastMessageAt ?? 0, at);
  });
  return { ok: true, draft: { ...draft, status: "auto" } };
}

// ---------- Nối vào luồng nhận tin ----------
const g = globalThis as unknown as { __kpBotTimers?: Map<string, ReturnType<typeof setTimeout>> };
const delayMs = () => { const n = Number(process.env.KPCHAT_BOT_DELAY_MS); return Number.isFinite(n) && n >= 0 && process.env.KPCHAT_BOT_DELAY_MS !== undefined ? n : 6000; };

// Khách thường nhắn vài tin liền: chờ một lúc rồi soạn cho cả cụm. Tin mới tới thì đặt lại giờ chờ.
export function scheduleBot(store: Store, convId: string) {
  const timers = (g.__kpBotTimers ??= new Map());
  clearTimeout(timers.get(convId));
  const t = setTimeout(() => {
    timers.delete(convId);
    void runBot(store, convId).catch(() => undefined);
  }, delayMs());
  t.unref?.();
  timers.set(convId, t);
}

export function initChatbot(_store: Store) {
  onInbound("chatbot", (store, convIds) => { for (const id of convIds) scheduleBot(store, id); });
}
