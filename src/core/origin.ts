// Địa chỉ mà TRÌNH DUYỆT đang dùng để mở KP Chat. Khi chạy sau proxy (Render, Railway), req.url của Next.js có thể là địa chỉ
// nội bộ (http://localhost:10000), nên phải đọc header Host / X-Forwarded-Host mà proxy chuyển tiếp từ trình duyệt.
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);
const first = (v: string | null) => v?.split(",")[0].trim() || undefined;

export function browserOrigin(headers: Headers, reqUrl: string): { origin: string; local: boolean } {
  const u = new URL(reqUrl);
  const host = first(headers.get("x-forwarded-host")) ?? first(headers.get("host")) ?? u.host;
  const proto = first(headers.get("x-forwarded-proto")) ?? u.protocol.replace(":", "");
  const hostname = host.replace(/:\d+$/, "").toLowerCase();
  return { origin: `${proto}://${host}`, local: LOCAL.has(hostname) };
}

// Địa chỉ công khai: KPCHAT_PUBLIC_URL nếu có, không thì địa chỉ trình duyệt đang dùng.
export const publicBase = (headers: Headers, reqUrl: string, publicUrl?: string) =>
  (publicUrl || browserOrigin(headers, reqUrl).origin).replace(/\/$/, "");

// Đăng nhập Facebook quay về: mở từ chính máy (localhost) thì quay về localhost (Meta cho khi app ở chế độ phát triển);
// mở từ địa chỉ công khai thì dùng địa chỉ công khai.
export function loginBaseOf(headers: Headers, reqUrl: string, publicUrl?: string) {
  const b = browserOrigin(headers, reqUrl);
  return b.local ? b.origin : publicBase(headers, reqUrl, publicUrl);
}
