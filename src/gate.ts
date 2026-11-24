// Cổng bảo vệ khi mở KP Chat ra Internet (đường hầm công khai). Bản chạy thử chưa có đăng nhập thật: ai mở được địa chỉ là làm quản trị được.
// Quy tắc: nếu đặt KPCHAT_PUBLIC_URL (đang công khai) thì BẮT BUỘC có KPCHAT_ACCESS_KEY; mở lần đầu bằng ?key=..., sau đó dùng cookie.
// Ngoại lệ: webhook của nền tảng (đã có chữ ký riêng) và ảnh công khai (đường dẫn là mã ngẫu nhiên 128 bit).
import { timingSafeEqual } from "node:crypto";

export type Gate = { action: "allow" } | { action: "setcookie"; key: string; redirect: string } | { action: "deny"; status: number; message: string };

const safeEq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const PUBLIC = [/^\/api\/webhook\/[a-z_]+$/, /^\/api\/web\/(widget\.js|session|messages|send|upload)$/, /^\/api\/media\/[0-9a-f]{32}\.(jpg|png|webp)$/, /^\/_next\//, /^\/favicon\.ico$/, /^\/api\/health$/];

export function gate(input: { pathname: string; queryKey?: string | null; cookieKey?: string | null; env: { KPCHAT_PUBLIC_URL?: string; KPCHAT_ACCESS_KEY?: string } }): Gate {
  const { pathname, queryKey, cookieKey, env } = input;
  if (!env.KPCHAT_PUBLIC_URL) return { action: "allow" }; // chỉ chạy trên máy: không cần cổng
  if (PUBLIC.some((r) => r.test(pathname))) return { action: "allow" };
  const key = env.KPCHAT_ACCESS_KEY;
  if (!key || key.length < 16) return { action: "deny", status: 503, message: "KP Chat đang mở ra Internet nhưng chưa đặt KPCHAT_ACCESS_KEY (tối thiểu 16 ký tự). Đặt khóa trong .env.local rồi khởi động lại." };
  if (cookieKey && safeEq(cookieKey, key)) return { action: "allow" };
  if (queryKey && safeEq(queryKey, key)) return { action: "setcookie", key, redirect: pathname };
  return { action: "deny", status: 401, message: "Cần khóa truy cập. Mở địa chỉ kèm ?key=... (khóa nằm trong .env.local của máy chủ)." };
}
