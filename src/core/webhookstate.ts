// Theo dõi webhook: lần cuối nhận tin qua từng loại kênh, và kiểm tra địa chỉ công khai còn truy cập được từ bên ngoài không.
// Đường hầm tạm (cloudflared) hay chết âm thầm: tiến trình vẫn chạy nhưng Meta gọi không tới, tin mới không về.
const g = globalThis as unknown as { __kpWebhookAt?: Record<string, number> };
export const markWebhook = (kind: string, at = Date.now()) => { (g.__kpWebhookAt ??= {})[kind] = at; };
export const webhookSeen = (): Record<string, number> => ({ ...(g.__kpWebhookAt ?? {}) });

export interface WebhookProbe { configured: boolean; reachable?: boolean; url?: string; detail?: string }

// Gọi thử đúng cách Meta xác minh webhook, qua địa chỉ công khai. Không đặt địa chỉ công khai hoặc khoá xác minh thì không kiểm được.
export async function probeWebhook(env: { KPCHAT_PUBLIC_URL?: string; META_VERIFY_TOKEN?: string }, f: typeof fetch = fetch, timeoutMs = 6000): Promise<WebhookProbe> {
  const base = (env.KPCHAT_PUBLIC_URL ?? "").replace(/\/$/, "");
  if (!base || !env.META_VERIFY_TOKEN) return { configured: false };
  const url = `${base}/api/webhook/facebook`;
  const challenge = "kpchat-" + Math.random().toString(36).slice(2, 10);
  // Bộ đếm thường (không dùng AbortSignal.timeout: bộ đếm của nó không giữ tiến trình, lời gọi có thể bị bỏ dở không bao giờ xong)
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(Object.assign(new Error("Quá thời gian chờ"), { name: "TimeoutError" })), timeoutMs);
  try {
    const r = await f(`${url}?${new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": env.META_VERIFY_TOKEN, "hub.challenge": challenge })}`, { signal: ctl.signal });
    const text = await r.text().catch(() => "");
    if (r.ok && text === challenge) return { configured: true, reachable: true, url: base };
    return { configured: true, reachable: false, url: base, detail: r.ok ? "Địa chỉ trả lời nhưng không phải KP Chat" : `Địa chỉ trả về mã ${r.status}` };
  } catch (e) {
    return { configured: true, reachable: false, url: base, detail: e instanceof Error && e.name === "TimeoutError" ? "Quá thời gian chờ" : "Không kết nối được" };
  } finally {
    clearTimeout(timer);
  }
}
