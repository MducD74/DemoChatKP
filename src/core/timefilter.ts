// Bộ lọc thời gian của hộp thư theo giờ Việt Nam (UTC+7), tuần bắt đầu từ thứ Hai. Thuần hàm, dùng được cả ở giao diện.
const H = 3600_000, DAY = 24 * H, VN = 7 * H;

export const TIME_OPTIONS: [string, string][] = [
  ["all", "Mọi lúc"], ["today", "Hôm nay"], ["yesterday", "Hôm qua"], ["week", "Tuần này"], ["lastweek", "Tuần qua"], ["month", "Tháng này"], ["lastmonth", "Tháng qua"], ["custom", "Tùy chọn"],
];

const dayStart = (t: number) => Math.floor((t + VN) / DAY) * DAY - VN; // 0 giờ (giờ VN) của ngày chứa t
const monthStart = (t: number, add = 0) => { const d = new Date(t + VN); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + add, 1) - VN; };
const weekStart = (t: number) => dayStart(t) - ((Math.floor((t + VN) / DAY) + 3) % 7) * DAY; // 1/1/1970 là thứ Năm
const parseDay = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(`${s}T00:00:00+07:00`)) ? Date.parse(`${s}T00:00:00+07:00`) : null);

export interface TimeRange { from: number; to: number } // nửa mở: từ <= t < đến

// Khoảng thời gian của lựa chọn; null là không lọc (Mọi lúc, hoặc Tùy chọn mà chưa chọn ngày nào)
export function timeRange(key: string, now: number, custom: { from?: string; to?: string } = {}): TimeRange | null {
  const today = dayStart(now), wk = weekStart(now);
  switch (key) {
    case "today": return { from: today, to: today + DAY };
    case "yesterday": return { from: today - DAY, to: today };
    case "week": return { from: wk, to: wk + 7 * DAY };
    case "lastweek": return { from: wk - 7 * DAY, to: wk };
    case "month": return { from: monthStart(now), to: monthStart(now, 1) };
    case "lastmonth": return { from: monthStart(now, -1), to: monthStart(now) };
    case "custom": {
      const f = parseDay(custom.from), t = parseDay(custom.to);
      if (f === null && t === null) return null;
      return { from: f ?? -Infinity, to: t === null ? Infinity : t + DAY }; // ngày "đến" tính hết ngày đó
    }
    default: return null;
  }
}

export const inRange = (t: number, r: TimeRange | null) => !r || (t >= r.from && t < r.to);
