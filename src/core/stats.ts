// Số liệu: trang Tổng quan (việc cần xử lý) và trang Thống kê (theo kênh, nhân viên, SLA). Chỉ đọc từ dữ liệu đã lưu.
import type { Store } from "./store";
import type { ChannelKind, Message } from "./types";
import { channelViews, type ChannelView } from "./connect";
import { addEpisode, avgFrt, avgLater, emptyTally, episodes, rate, waitState, type SlaState, type SlaTally } from "./sla";
import { canView, isAdmin } from "./policy";
import type { Actor } from "./staff";
import { NEED_HUMAN_WAIT_MIN, needHumanMap } from "./botqueue";

// ---------- Tổng quan ----------
export interface Overview {
  totals: { open: number; unassigned: number; waiting: number; slaBreach: number; slaSoon: number; slaAny: boolean; unreadAll: number; resolvedToday: number };
  channels: Array<{ id: string; name: string; kind: ChannelKind; status: ChannelView["status"]; sendEnabled: boolean; sla: boolean; open: number; unassigned: number; waiting: number; refreshExpiresAt?: number }>;
  staff: Array<{ uid: string; open: number; waiting: number }>;
  attention: Array<{ id: string; contactName: string; channelName: string; kind: ChannelKind; waitMin: number; assigneeUid?: string; lastText: string; sla?: { state: SlaState; limitMin: number } }>;
  alerts: Array<{ level: "bad" | "warn"; text: string; channelId?: string }>;
  // Chatbot: chỉ hiện khi bot đã từng trả lời hoặc đang có hội thoại chờ người
  bot: { used: boolean; repliesToday: number; need: number; needLate: number };
}

function lastMessages(messages: Message[]) {
  const last = new Map<string, { at: number; direction: "in" | "out"; text: string }>();
  for (const m of messages) {
    if (m.internal) continue;
    const cur = last.get(m.conversationId);
    if (!cur || m.at > cur.at) last.set(m.conversationId, { at: m.at, direction: m.direction, text: m.text });
  }
  return last;
}

export async function overview(store: Store, now = Date.now()): Promise<Overview> {
  const db = await store.load();
  const views = await channelViews(store, now);
  const last = lastMessages(Object.values(db.messages));
  const startOfDay = new Date(now).setHours(0, 0, 0, 0);
  const t = { open: 0, unassigned: 0, waiting: 0, slaBreach: 0, slaSoon: 0, slaAny: Object.values(db.channels).some((c) => !c.off && c.sla), unreadAll: 0, resolvedToday: 0 };
  const perCh = new Map<string, { open: number; unassigned: number; waiting: number }>();
  const perStaff = new Map<string, { open: number; waiting: number }>();
  const attention: Overview["attention"] = [];
  for (const c of Object.values(db.conversations)) {
    const ch = db.channels[c.channelId];
    const ct = db.contacts[c.contactId];
    if (!ch || !ct) continue;
    const lm = last.get(c.id);
    if (c.status === "resolved") {
      if ((c.lastMessageAt ?? 0) >= startOfDay) t.resolvedToday++;
      continue;
    }
    t.open++;
    const pc = perCh.get(ch.id) ?? { open: 0, unassigned: 0, waiting: 0 };
    pc.open++;
    if (!c.assigneeUid) { t.unassigned++; pc.unassigned++; }
    const waiting = lm?.direction === "in";
    if (c.assigneeUid) {
      const ps = perStaff.get(c.assigneeUid) ?? { open: 0, waiting: 0 };
      ps.open++;
      if (waiting) ps.waiting++;
      perStaff.set(c.assigneeUid, ps);
    }
    if (waiting && lm) {
      t.waiting++;
      pc.waiting++;
      const w = waitState(ch, c.assigneeUid, lm.at, now);
      if (w?.state === "breach") t.slaBreach++;
      if (w?.state === "soon") t.slaSoon++;
      attention.push({ id: c.id, contactName: ct.name, channelName: ch.name, kind: ch.kind, waitMin: Math.max(0, Math.round((now - lm.at) / 60000)), assigneeUid: c.assigneeUid, lastText: lm.text, sla: w && { state: w.state, limitMin: w.limitMin } });
    }
    perCh.set(ch.id, pc);
  }
  // Vượt SLA lên đầu, rồi theo thời gian chờ
  const rank = (a: Overview["attention"][number]) => (a.sla?.state === "breach" ? 2 : a.sla?.state === "soon" ? 1 : 0);
  attention.sort((a, b) => rank(b) - rank(a) || b.waitMin - a.waitMin);

  const alerts: Overview["alerts"] = [];
  const channels = views.filter((v) => !v.off).map((v) => {
    const pc = perCh.get(v.id) ?? { open: 0, unassigned: 0, waiting: 0 };
    if (v.status === "expired") alerts.push({ level: "bad", channelId: v.id, text: `${v.name}: quyền truy cập đã hết hạn, cần cấp quyền lại.` });
    else if (v.status === "no_token") alerts.push({ level: "warn", channelId: v.id, text: `${v.name}: chưa có token, chưa nhận được tin.` });
    else if (v.status === "pending") alerts.push({ level: "warn", channelId: v.id, text: `${v.name}: đang chờ cấp quyền.` });
    else {
      if (v.refreshExpiresAt && v.refreshExpiresAt - now < 14 * 86400_000) alerts.push({ level: "warn", channelId: v.id, text: `${v.name}: quyền truy cập sắp hết hạn (${new Date(v.refreshExpiresAt).toLocaleDateString("vi-VN")}), nên cấp quyền lại.` });
      if (!v.sendEnabled) alerts.push({ level: "warn", channelId: v.id, text: `${v.name}: đã kết nối nhưng đang tắt gửi tin, nhân viên chưa trả lời được.` });
    }
    return { id: v.id, name: v.name, kind: v.kind, status: v.status, sendEnabled: v.sendEnabled, sla: !!v.sla, refreshExpiresAt: v.refreshExpiresAt, ...pc };
  });
  if (!channels.length) alerts.push({ level: "warn", text: "Chưa có kênh nào. Thêm kênh ở mục Cài đặt." });
  if (t.slaSoon > 0) alerts.unshift({ level: "warn", text: `${t.slaSoon} khách sắp vượt SLA phản hồi.` });
  if (t.slaBreach > 0) alerts.unshift({ level: "bad", text: `${t.slaBreach} khách đã vượt SLA phản hồi mà chưa được trả lời.` });
  if (t.unassigned > 0) alerts.push({ level: "warn", text: `${t.unassigned} hội thoại chưa có người nhận.` });
  // Hàng đợi cần người: bot đã chuyển hoặc đề nghị chuyển người mà chưa ai xử lý
  const need = [...needHumanMap(db, now)];
  const needLate = need.filter(([, n]) => n.overdue).length;
  if (need.length - needLate > 0) alerts.unshift({ level: "warn", text: `${need.length - needLate} hội thoại chatbot đã chuyển người, đang chờ nhân viên xử lý.` });
  if (needLate > 0) alerts.unshift({ level: "bad", text: `${needLate} hội thoại chatbot đã chuyển người, chờ quá ${NEED_HUMAN_WAIT_MIN} phút mà chưa ai xử lý.` });

  const botMsgs = Object.values(db.messages).filter((m) => m.bot && m.direction === "out" && !m.internal);
  const bot = { used: botMsgs.length > 0 || need.length > 0, repliesToday: botMsgs.filter((m) => m.at >= startOfDay).length, need: need.length, needLate };
  return { totals: t, channels, staff: [...perStaff].map(([uid, v]) => ({ uid, ...v })), attention: attention.slice(0, 12), alerts, bot };
}

// ---------- Thống kê ----------
export interface StatFilter { from: number; to: number; channelId?: string; staffUid?: string }
export interface SlaRow { configured: boolean; rate: number | null; avgFrtMin: number | null; answered: number; within: number; breached: number; missed: number; avgLaterMin: number | null }
const slaRow = (t: SlaTally, configured: boolean): SlaRow => ({ configured, rate: rate(t), avgFrtMin: avgFrt(t), answered: t.answered, within: t.within, breached: t.breached, missed: t.missed, avgLaterMin: avgLater(t) });

export interface Statistics {
  range: { from: number; to: number };
  scope: "all" | "self"; // nhân viên chỉ thấy số của mình
  cards: { conversations: number; open: number; unanswered: number; unassigned: number; done: number; withPhone: number; slaRate: number | null; avgFrtMin: number | null; missed: number; avgClaimMin: number | null; slaAny: boolean };
  byChannel: Array<{ id: string; name: string; kind: ChannelKind; conversations: number; open: number; unanswered: number; done: number; unassigned: number; sla: SlaRow }>;
  byStaff: Array<{ uid: string; conversations: number; open: number; unanswered: number; done: number; sla: SlaRow; avgClaimMin: number | null }>;
  slaDetail: Array<{ uid: string; channelId: string; channelName: string; limitMin: number; hours: boolean; sla: SlaRow }>;
  cross: Array<{ channelName: string; counts: Record<string, number> }>;
  byLabel: Array<[string, number]>;
  byDay: Array<[string, number]>; // số tin khách theo ngày (giờ Việt Nam)
}

const vnDay = (t: number) => new Date(t + 7 * 3600_000).toISOString().slice(0, 10);

export async function statistics(store: Store, actor: Actor, f: StatFilter, now = Date.now()): Promise<Statistics> {
  const db = await store.load();
  const self = !isAdmin(actor);
  const msgsBy = new Map<string, Message[]>();
  for (const m of Object.values(db.messages)) {
    if (m.history) continue; // tin lịch sử tải về không tính vào thống kê
    const l = msgsBy.get(m.conversationId);
    if (l) l.push(m); else msgsBy.set(m.conversationId, [m]);
  }

  const inRange = (t: number) => t >= f.from && t <= f.to;
  const staffFilter = self ? actor.uid : f.staffUid;
  const tallyAll = emptyTally();
  const chRows = new Map<string, Statistics["byChannel"][number]>();
  const chTally = new Map<string, SlaTally>();
  const stRows = new Map<string, Statistics["byStaff"][number]>();
  const stTally = new Map<string, SlaTally>();
  const stClaim = new Map<string, { n: number; sum: number }>();
  const detail = new Map<string, { uid: string; channelId: string; channelName: string; limitMin: number; hours: boolean; t: SlaTally }>();
  const cross = new Map<string, Record<string, number>>();
  const labels = new Map<string, number>();
  const days = new Map<string, number>();
  let claimN = 0, claimSum = 0;
  const cards = { conversations: 0, open: 0, unanswered: 0, unassigned: 0, done: 0, withPhone: 0 };
  const slaAny = Object.values(db.channels).some((c) => !c.off && c.sla);

  const getCh = (id: string) => {
    const ch = db.channels[id];
    if (!chRows.has(id)) chRows.set(id, { id, name: ch.name, kind: ch.kind, conversations: 0, open: 0, unanswered: 0, done: 0, unassigned: 0, sla: slaRow(emptyTally(), !!ch.sla) });
    if (!chTally.has(id)) chTally.set(id, emptyTally());
    return chRows.get(id)!;
  };
  const getSt = (uid: string) => {
    if (!stRows.has(uid)) stRows.set(uid, { uid, conversations: 0, open: 0, unanswered: 0, done: 0, sla: slaRow(emptyTally(), false), avgClaimMin: null });
    if (!stTally.has(uid)) stTally.set(uid, emptyTally());
    return stRows.get(uid)!;
  };

  for (const c of Object.values(db.conversations)) {
    const ch = db.channels[c.channelId], ct = db.contacts[c.contactId];
    if (!ch || !ct || !canView(actor, c, ch)) continue;
    if (f.channelId && c.channelId !== f.channelId) continue;
    const msgs = (msgsBy.get(c.id) ?? []).filter((m) => !m.internal);
    const eps = episodes(msgs, c);
    // Hội thoại được tính nếu có hoạt động trong kỳ; lượt chờ tính theo lúc khách nhắn (hoặc đang chờ tới nay)
    const active = inRange(c.lastMessageAt ?? 0) || eps.some((e) => inRange(e.start));
    if (!active) continue;
    const mine = !staffFilter || c.assigneeUid === staffFilter;

    // Số liệu theo lượt chờ: gán cho người trả lời; lượt đang chờ gán cho người phụ trách
    for (const e of eps) {
      if (!inRange(e.start)) continue;
      const who = e.by;
      if (staffFilter && who !== staffFilter) continue;
      addEpisode(tallyAll, e, ch, now);
      getCh(c.channelId);
      addEpisode(chTally.get(c.channelId)!, e, ch, now);
      if (who) {
        getSt(who);
        addEpisode(stTally.get(who)!, e, ch, now);
        if (ch.sla) {
          const k = `${who}|${ch.id}`;
          if (!detail.has(k)) detail.set(k, { uid: who, channelId: ch.id, channelName: ch.name, limitMin: ch.sla.perUser?.[who] ?? ch.sla.firstResponseMin, hours: !!ch.sla.hours, t: emptyTally() });
          addEpisode(detail.get(k)!.t, e, ch, now);
        }
      }
    }

    if (!mine) continue;
    const row = getCh(c.channelId);
    const lm = [...msgs].sort((a, b) => b.at - a.at)[0];
    const waiting = c.status !== "resolved" && lm?.direction === "in";
    row.conversations++; cards.conversations++;
    if (c.status === "resolved") { row.done++; cards.done++; } else { row.open++; cards.open++; }
    if (waiting) { row.unanswered++; cards.unanswered++; }
    if (c.status !== "resolved" && !c.assigneeUid) { row.unassigned++; cards.unassigned++; }
    if (ct.phone) cards.withPhone++;
    const sk = c.assigneeUid ?? "";
    if (sk) {
      const s = getSt(sk);
      s.conversations++;
      if (c.status === "resolved") s.done++; else s.open++;
      if (waiting) s.unanswered++;
    }
    const firstIn = msgs.filter((m) => m.direction === "in").sort((a, b) => a.at - b.at)[0];
    if (c.assignedAt && firstIn && inRange(firstIn.at) && c.assignedAt >= firstIn.at) {
      const min = (c.assignedAt - firstIn.at) / 60_000;
      claimN++; claimSum += min;
      if (sk) { const cl = stClaim.get(sk) ?? { n: 0, sum: 0 }; cl.n++; cl.sum += min; stClaim.set(sk, cl); }
    }
    if (c.status !== "resolved") {
      const cr = cross.get(ch.name) ?? {};
      const key = c.assigneeUid ?? "";
      cr[key] = (cr[key] ?? 0) + 1;
      cross.set(ch.name, cr);
    }
    for (const l of c.labels) labels.set(l, (labels.get(l) ?? 0) + 1);
    for (const m of msgs) if (m.direction === "in" && inRange(m.at)) days.set(vnDay(m.at), (days.get(vnDay(m.at)) ?? 0) + 1);
  }

  for (const [id, row] of chRows) row.sla = slaRow(chTally.get(id) ?? emptyTally(), !!db.channels[id].sla);
  for (const [uid, row] of stRows) {
    row.sla = slaRow(stTally.get(uid) ?? emptyTally(), slaAny);
    const cl = stClaim.get(uid);
    row.avgClaimMin = cl ? cl.sum / cl.n : null;
  }
  return {
    range: { from: f.from, to: f.to },
    scope: self ? "self" : "all",
    cards: { ...cards, slaRate: rate(tallyAll), avgFrtMin: avgFrt(tallyAll), missed: tallyAll.missed, avgClaimMin: claimN ? claimSum / claimN : null, slaAny },
    byChannel: [...chRows.values()].sort((a, b) => b.conversations - a.conversations),
    byStaff: [...stRows.values()].sort((a, b) => b.conversations - a.conversations),
    slaDetail: [...detail.values()].map(({ t, ...d }) => ({ ...d, sla: slaRow(t, true) })).sort((a, b) => a.channelName.localeCompare(b.channelName) || a.uid.localeCompare(b.uid)),
    cross: [...cross].map(([channelName, counts]) => ({ channelName, counts })),
    byLabel: [...labels].sort((a, b) => b[1] - a[1]).slice(0, 12),
    byDay: [...days].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 14),
  };
}
