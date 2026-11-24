// Phân công chatbot cho hội thoại, đi cùng người phụ trách. Một hội thoại có thể có cả nhân viên và chatbot:
// - Chatbot: "Theo kênh" (tự chọn theo kênh và khách mới hay cũ, như cũ), một chatbot cụ thể của kênh, hoặc "Không dùng bot".
// - Phối hợp: mặc định bot nhường khi đã có nhân viên nhận; bật "bot trả lời cùng nhân viên" thì bot vẫn trả lời, riêng khi nhân viên vừa trả lời
//   thì bot tạm dừng một giờ như mọi khi (xem autoGuard). Nhân viên bấm Tiếp quản thì bot dừng hẳn (botCtl) bất kể chọn gì ở đây.
import { chooseBot, botList, botSettings, NEW_CUSTOMER_DAYS, type BotType } from "./chatbot";
import { messagesByConv, messagesOf, mutate, type DB, type Store } from "./store";
import { canAct } from "./policy";
import { autoGuard } from "./botauto";
import type { Actor } from "./staff";

const DAY = 24 * 3600_000;

export interface BotAssignInfo {
  options: { id: string; name: string; type: BotType; mode: string }[]; // các chatbot gắn với kênh của hội thoại
  sel: "" | "none" | string; // "" = theo kênh
  withStaff: boolean;
  picked: { id: string; name: string; mode: string } | null; // chatbot sẽ trả lời theo lựa chọn hiện tại (kể cả đang tắt)
  auto: { id: string; name: string } | null; // chatbot được chọn tự động theo Giai đoạn CRM khi nhân viên không chọn tay
}

export function botAssignInfo(db: DB, convId: string, now: number): BotAssignInfo | null {
  const conv = db.conversations[convId];
  if (!conv) return null;
  const here = botList(db).filter((b) => b.channelIds.includes(conv.channelId));
  if (!here.length) return null;
  const first = messagesOf(db, convId)[0]?.at ?? Infinity;
  const type: BotType = !Number.isFinite(first) || now - first <= NEW_CUSTOMER_DAYS * DAY ? "new" : "care";
  const p = chooseBot(here, conv.botSel, type, { any: true }, conv.stage);
  const au = chooseBot(here, undefined, type, { any: true }, conv.stage);
  const none = !!conv.botSel?.none;
  return {
    options: here.map((b) => ({ id: b.id, name: b.name, type: b.type, mode: b.mode })),
    sel: none ? "none" : conv.botSel?.botId && here.some((b) => b.id === conv.botSel?.botId) ? conv.botSel.botId : "",
    withStaff: !!conv.botSel?.withStaff,
    picked: none || !p ? null : { id: p.id, name: p.name, mode: p.mode },
    auto: au ? { id: au.id, name: au.name } : null,
  };
}

// Chatbot của từng hội thoại và việc nó đang làm (cho danh sách và bộ lọc): phụ trách (tự trả lời), gợi ý (soạn nháp) hoặc tạm dừng. Hội thoại không có chatbot thì không có mục.
// Tính một lượt, không quét lại tin nhiều lần. "Cần người" do botqueue tính riêng.
export type BotHandling = { id: string; name: string; mode: "auto" | "draft"; withStaff: boolean; state: "handling" | "suggesting" | "paused" };
export function botHandlers(db: DB, now: number): Map<string, BotHandling> {
  const out = new Map<string, BotHandling>();
  const bots = botList(db);
  if (!bots.length) return out;
  const systemPaused = botSettings(db).paused;
  const first = new Map<string, number>();
  for (const [cid, arr] of messagesByConv(db)) first.set(cid, arr[0].at);
  for (const c of Object.values(db.conversations)) {
    const ch = db.channels[c.channelId];
    if (!ch || ch.off || c.status === "resolved") continue;
    const f = first.get(c.id);
    const type: BotType = f == null || now - f <= NEW_CUSTOMER_DAYS * DAY ? "new" : "care";
    const bot = chooseBot(bots.filter((b) => b.channelIds.includes(c.channelId)), c.botSel, type, {}, c.stage);
    if (!bot || (bot.mode !== "auto" && bot.mode !== "draft")) continue;
    const paused = systemPaused || !!c.botCtl?.off || (bot.mode === "auto" && autoGuard(db, c, ch, now) !== null);
    out.set(c.id, { id: bot.id, name: bot.name, mode: bot.mode, withStaff: !!(c.assigneeUid && !c.autoAssigned && c.botSel?.withStaff), state: paused ? "paused" : bot.mode === "draft" ? "suggesting" : "handling" });
  }
  return out;
}

// Nhân viên chọn chatbot cho hội thoại: bot = "" (theo kênh), "none" (không dùng bot) hoặc mã chatbot của kênh
export async function setBotAssign(store: Store, convId: string, input: { bot?: unknown; withStaff?: unknown }, actor: Actor): Promise<{ ok: true } | { ok: false; error: string }> {
  return mutate(store, (db): { ok: true } | { ok: false; error: string } => {
    const c = db.conversations[convId];
    if (!c) return { ok: false, error: "Không thấy hội thoại" };
    if (!canAct(actor, c, db.channels[c.channelId])) return { ok: false, error: "Bạn không có quyền với hội thoại này" };
    const bot = String(input.bot ?? "");
    const withStaff = !!input.withStaff;
    const here = botList(db).filter((b) => b.channelIds.includes(c.channelId));
    if (bot && bot !== "none" && !here.some((b) => b.id === bot)) return { ok: false, error: "Chatbot này không gắn với kênh của hội thoại" };
    const old = c.botSel;
    const at = Date.now();
    if (!bot && !withStaff) c.botSel = undefined;
    else c.botSel = { ...(bot === "none" ? { none: true } : bot ? { botId: bot } : {}), ...(withStaff && bot !== "none" ? { withStaff: true } : {}), by: actor.uid, at };
    const label = (s?: typeof old) => (s?.none ? "không dùng chatbot" : s?.botId ? here.find((b) => b.id === s.botId)?.name ?? "chatbot đã xóa" : "theo kênh") + (s?.withStaff ? ", trả lời cùng nhân viên" : "");
    if (label(old) !== label(c.botSel)) (c.log ??= []).push({ at, by: actor.uid, text: `Chatbot phụ trách: ${label(old)} → ${label(c.botSel)}` });
    return { ok: true };
  });
}

// Nhân viên đang gõ trong ô soạn của hội thoại: ghi lại để chatbot chờ (autoGuard). Giao diện báo mỗi khoảng 15 giây; ghi tối đa 10 giây một lần cho nhẹ.
export async function markTyping(store: Store, convId: string, actor: Actor, now = Date.now()): Promise<{ ok: true } | { ok: false; error: string }> {
  const db0 = await store.load();
  const c0 = db0.conversations[convId];
  if (!c0) return { ok: false, error: "Không thấy hội thoại" };
  if (!canAct(actor, c0, db0.channels[c0.channelId])) return { ok: false, error: "Bạn không có quyền với hội thoại này" };
  if (c0.typingAt && now - c0.typingAt < 10_000) return { ok: true };
  await mutate(store, (db) => { const c = db.conversations[convId]; if (c) c.typingAt = now; });
  return { ok: true };
}
