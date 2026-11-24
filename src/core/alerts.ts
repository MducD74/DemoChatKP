// Cảnh báo vận hành cho quản trị (yêu cầu 2.5 và 6.2): token kênh hết hạn hoặc bị thu hồi, Page chưa đăng ký nhận tin,
// webhook không truy cập được từ Internet. Kết quả lưu đệm vài phút để nhiều người mở trang cùng lúc không gọi Meta liên tục.
// Có kiểm tra định kỳ ở máy chủ (ghi nhật ký dòng [canh-bao]) để thấy được cả khi không ai mở trang.
import type { Store } from "./store";
import { checkMetaHealth, type ChannelHealth } from "./metahealth";
import { probeWebhook, type WebhookProbe } from "./webhookstate";
import { defaultPaths, lastBackup, listBackups } from "./backup";

export interface OpsAlert { level: "error" | "warn"; key: string; text: string; channelId?: string }

export const ALERT_TTL_MS = 5 * 60_000;

export const BACKUP_STALE_MS = 36 * 3600_000; // quá lâu không có bản sao lưu mới thì cảnh báo

export function buildAlerts(input: { channels: Array<{ id: string; name: string; kind: string; off?: boolean }>; health: Record<string, ChannelHealth>; webhook: WebhookProbe; backup?: { lastAt?: number; error?: string; enabled: boolean }; now?: number }): OpsAlert[] {
  const out: OpsAlert[] = [];
  const b = input.backup;
  if (b?.enabled) {
    if (b.error) out.push({ level: "error", key: "backup", text: `Sao lưu hằng ngày bị lỗi: ${b.error}. Xem nhật ký máy chủ dòng [sao-luu].` });
    else if ((input.now ?? Date.now()) - (b.lastAt ?? 0) > BACKUP_STALE_MS) out.push({ level: "warn", key: "backup", text: b.lastAt ? "Hơn 36 giờ chưa có bản sao lưu mới." : "Chưa có bản sao lưu nào (bản đầu tạo sau 3 giờ sáng, hoặc chạy npm run backup)." });
  }
  const { webhook } = input;
  if (webhook.configured && webhook.reachable === false) {
    out.push({ level: "error", key: "webhook", text: `Webhook không truy cập được từ Internet (${webhook.detail ?? "lỗi"}): tin khách mới sẽ không về KP Chat. Kiểm tra máy chủ và tên miền; khi đã chạy lại, dùng "Khôi phục tin lỡ" ở Cài đặt > Kênh.` });
  }
  for (const c of input.channels) {
    if (c.off) continue;
    const h = input.health[c.id];
    if (!h) continue;
    if (!h.ok) out.push({ level: "error", key: `token:${c.id}`, channelId: c.id, text: `Kênh "${c.name}": ${h.error ?? "token không dùng được"}. Vào Cài đặt > Kênh, bấm "Kết nối lại" (đăng nhập Facebook bằng tài khoản quản trị Page).` });
    else if (h.subscribed === false) out.push({ level: "warn", key: `sub:${c.id}`, channelId: c.id, text: `Page "${c.name}" chưa đăng ký nhận tin về KP Chat: tin mới sẽ không về. Vào Cài đặt > Kênh > chi tiết Page, bước "Đăng ký nhận tin".` });
  }
  return out;
}

const g = globalThis as unknown as { __kpAlerts?: { at: number; alerts: OpsAlert[]; running?: Promise<OpsAlert[]> }; __kpAlertTimer?: ReturnType<typeof setInterval> };

export async function collectAlerts(store: Store, env: Record<string, string | undefined> = process.env, opts: { force?: boolean; now?: number } = {}): Promise<OpsAlert[]> {
  const now = opts.now ?? Date.now();
  const c = g.__kpAlerts;
  if (!opts.force && c && now - c.at < ALERT_TTL_MS) return c.alerts;
  if (c?.running) return c.running;
  const running = (async () => {
    const [health, webhook, db] = await Promise.all([
      checkMetaHealth(store, { appId: env.META_APP_ID }).catch(() => ({})),
      probeWebhook({ KPCHAT_PUBLIC_URL: env.KPCHAT_PUBLIC_URL, META_VERIFY_TOKEN: env.META_VERIFY_TOKEN }).catch((): WebhookProbe => ({ configured: false })),
      store.load(),
    ]);
    const last = (await listBackups(defaultPaths()).catch(() => []))[0];
    const run = lastBackup();
    // Lỗi chỉ tính khi lần chạy gần nhất lỗi và chưa có bản tốt nào sau đó
    const backup = { enabled: env.NODE_ENV !== "test" && env.KPCHAT_BACKUP !== "0", lastAt: last?.at, error: run && !run.ok && run.at > (last?.at ?? 0) ? run.error : undefined };
    return buildAlerts({ channels: Object.values(db.channels), health, webhook, backup });
  })();
  g.__kpAlerts = { at: c?.at ?? 0, alerts: c?.alerts ?? [], running };
  try {
    const alerts = await running;
    g.__kpAlerts = { at: now, alerts };
    return alerts;
  } catch {
    g.__kpAlerts = { at: c?.at ?? 0, alerts: c?.alerts ?? [] };
    return c?.alerts ?? [];
  }
}

// Kiểm tra định kỳ ở máy chủ: cảnh báo MỚI xuất hiện thì ghi nhật ký (không ghi token hay nội dung tin)
export function startAlertMonitor(store: Store, everyMs = ALERT_TTL_MS) {
  if (g.__kpAlertTimer) return;
  let last = new Set<string>();
  const tick = async () => {
    const alerts = await collectAlerts(store, process.env, { force: true }).catch(() => []);
    const keys = new Set(alerts.map((a) => a.key));
    for (const a of alerts) if (!last.has(a.key)) console.warn(`[canh-bao] ${a.level === "error" ? "LỖI" : "CHÚ Ý"}: ${a.text}`);
    for (const k of last) if (!keys.has(k)) console.info(`[canh-bao] đã hết: ${k}`);
    last = keys;
  };
  g.__kpAlertTimer = setInterval(() => void tick(), everyMs);
  g.__kpAlertTimer.unref?.();
  setTimeout(() => void tick(), 15_000).unref?.();
}
