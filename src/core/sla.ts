// Đo SLA từ lịch sử tin nhắn đã lưu. Không có mặc định: kênh chưa cài SLA thì không đo, không cảnh báo.
import type { Channel, Conversation, Message, SlaCfg } from "./types";

const TZ_MS = 7 * 3600_000; // giờ Việt Nam (UTC+7), không đổi giờ mùa hè
const DAY = 86_400_000;
export const NEW_SESSION_GAP = 4 * 3600_000; // im lặng quá 4 giờ thì tin khách kế tiếp tính là phiên mới

const mins = (hhmm: string) => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

export type Hours = { days: number[]; start: string; end: string };
// Kiểm giờ làm việc (dùng chung cho SLA và chia khách)
export function cleanHours(h: Partial<Hours>): { ok: true; hours: Hours } | { ok: false; error: string } {
  const days = [...new Set((h.days ?? []).map(Number))].filter((d) => d >= 1 && d <= 7).sort();
  const a = mins(String(h.start)), b = mins(String(h.end));
  if (!days.length) return { ok: false, error: "Chọn ít nhất một ngày làm việc" };
  if (a === null || b === null || a >= b) return { ok: false, error: "Giờ làm việc không hợp lệ (giờ bắt đầu phải sớm hơn giờ kết thúc, trong cùng một ngày)" };
  return { ok: true, hours: { days, start: String(h.start), end: String(h.end) } };
}

// Kiểm cấu hình SLA do quản trị nhập; trả lỗi tiếng Việt hoặc bản đã làm sạch.
export function cleanSla(input: unknown, staffUids: string[]): { ok: true; sla: SlaCfg } | { ok: false; error: string } {
  const s = input as Partial<SlaCfg> | null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : NaN);
  const fr = num(s?.firstResponseMin);
  if (!(fr >= 1 && fr <= 1440)) return { ok: false, error: "Ngưỡng phản hồi phải từ 1 đến 1.440 phút" };
  const out: SlaCfg = { firstResponseMin: fr };
  if (s?.missedMin != null) {
    const m = num(s.missedMin);
    if (!(m >= 1 && m <= 10080)) return { ok: false, error: "Ngưỡng bỏ lỡ phải từ 1 đến 10.080 phút" };
    if (m < fr) return { ok: false, error: "Ngưỡng bỏ lỡ không được nhỏ hơn ngưỡng phản hồi" };
    out.missedMin = m;
  }
  if (s?.hours) {
    const h = cleanHours(s.hours);
    if (!h.ok) return h;
    out.hours = h.hours;
  }
  if (s?.perUser) {
    out.perUser = {};
    for (const [uid, v] of Object.entries(s.perUser)) {
      if (!staffUids.includes(uid)) return { ok: false, error: `Nhân viên "${uid}" không hợp lệ` };
      const m = num(v);
      if (!(m >= 1 && m <= 1440)) return { ok: false, error: "Ngưỡng riêng của nhân viên phải từ 1 đến 1.440 phút" };
      out.perUser[uid] = m;
    }
  }
  return { ok: true, sla: out };
}

// Số mili giây nằm trong giờ làm việc giữa hai mốc. Không đặt giờ làm việc thì tính cả thời gian thực.
export function workingMs(start: number, end: number, hours?: SlaCfg["hours"]): number {
  if (end <= start) return 0;
  if (!hours) return end - start;
  const a = mins(hours.start)!, b = mins(hours.end)!;
  let total = 0;
  const first = Math.floor((start + TZ_MS) / DAY);
  const last = Math.floor((end + TZ_MS) / DAY);
  for (let d = first; d <= last; d++) {
    const dow = new Date(d * DAY).getUTCDay() || 7; // 1 = thứ hai … 7 = chủ nhật
    if (!hours.days.includes(dow)) continue;
    const ws = d * DAY - TZ_MS + a * 60_000, we = d * DAY - TZ_MS + b * 60_000;
    total += Math.max(0, Math.min(end, we) - Math.max(start, ws));
  }
  return total;
}

export const thresholdFor = (ch: Pick<Channel, "sla"> | undefined, uid?: string): number | undefined =>
  ch?.sla ? (uid ? ch.sla.perUser?.[uid] : undefined) ?? ch.sla.firstResponseMin : undefined;

export interface Episode {
  start: number; // tin đầu của khách chưa được trả lời
  end?: number; // lúc có tin của shop; trống = khách đang chờ
  first: boolean; // phản hồi đầu của một phiên (khác với các lượt trả lời sau)
  by?: string; // người trả lời (hoặc người phụ trách nếu tin gửi từ nơi khác)
}

// Tách lịch sử thành các lượt "khách nhắn, chờ shop trả lời". Bỏ qua ghi chú nội bộ.
export function episodes(messages: Message[], conv: Pick<Conversation, "assigneeUid">): Episode[] {
  const out: Episode[] = [];
  let lastAt = 0, wait: { start: number; first: boolean } | null = null;
  for (const m of [...messages].filter((x) => !x.internal && !x.history && !x.bot).sort((a, b) => a.at - b.at)) {
    if (m.direction === "in") {
      if (!wait) wait = { start: m.at, first: lastAt === 0 || m.at - lastAt > NEW_SESSION_GAP };
    } else if (wait) {
      out.push({ start: wait.start, end: m.at, first: wait.first, by: m.senderUid ?? conv.assigneeUid });
      wait = null;
    }
    lastAt = m.at;
  }
  if (wait) out.push({ start: wait.start, first: wait.first, by: conv.assigneeUid });
  return out;
}

export type SlaState = "ok" | "soon" | "breach";
const SOON_RATIO = 0.8; // đã chờ từ 80% ngưỡng thì báo "sắp vượt"

// Tình trạng của một khách đang chờ. Kênh chưa cài SLA thì trả undefined.
export function waitState(ch: Pick<Channel, "sla"> | undefined, uid: string | undefined, since: number, now: number): { state: SlaState; waitMin: number; limitMin: number } | undefined {
  const th = thresholdFor(ch, uid);
  if (!th || !ch?.sla) return undefined;
  const waitMin = workingMs(since, now, ch.sla.hours) / 60_000;
  return { state: waitMin > th ? "breach" : waitMin >= th * SOON_RATIO ? "soon" : "ok", waitMin, limitMin: th };
}

export interface SlaTally {
  answered: number; // lượt phản hồi đầu đã được trả lời
  within: number; // trong đó đạt ngưỡng
  breached: number; // chưa trả lời mà đã vượt ngưỡng (tính là không đạt)
  frtSumMin: number; // tổng phút phản hồi đầu của các lượt đã trả lời
  laterAnswered: number;
  laterSumMin: number;
  missed: number; // chưa trả lời quá ngưỡng bỏ lỡ (chỉ khi kênh có đặt)
}
export const emptyTally = (): SlaTally => ({ answered: 0, within: 0, breached: 0, frtSumMin: 0, laterAnswered: 0, laterSumMin: 0, missed: 0 });

export function addEpisode(t: SlaTally, e: Episode, ch: Pick<Channel, "sla"> | undefined, now: number) {
  const sla = ch?.sla;
  if (!sla) return;
  const th = thresholdFor(ch, e.by)!;
  const waitMin = workingMs(e.start, e.end ?? now, sla.hours) / 60_000;
  if (e.end !== undefined) {
    if (e.first) { t.answered++; t.frtSumMin += waitMin; if (waitMin <= th) t.within++; }
    else { t.laterAnswered++; t.laterSumMin += waitMin; }
  } else {
    if (e.first && waitMin > th) t.breached++;
    if (sla.missedMin && waitMin > sla.missedMin) t.missed++;
  }
}

export const rate = (t: SlaTally): number | null => { const d = t.answered + t.breached; return d ? t.within / d : null; };
export const avgFrt = (t: SlaTally): number | null => (t.answered ? t.frtSumMin / t.answered : null);
export const avgLater = (t: SlaTally): number | null => (t.laterAnswered ? t.laterSumMin / t.laterAnswered : null);
