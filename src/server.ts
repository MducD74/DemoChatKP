// Điểm chung phía máy chủ: kho dữ liệu, adapter, người dùng thử.
import { JsonStore } from "@/core/store";
import { resumeZaloPersonal } from "@/core/zalopersonal";
import { ZALO_PERSONAL_ENABLED } from "@/core/guardrails";
import { startAlertMonitor } from "@/core/alerts";
import { startBackupSchedule } from "@/core/backup";
import { initAdapters } from "@/adapters";
import { initChatbot } from "@/core/botauto";
import { getAdapter } from "@/core/adapter";
import { loginBaseOf, publicBase } from "@/core/origin";
import type { createZaloAdapter } from "@/adapters/zalo";
import type { createTikTokAdapter } from "@/adapters/tiktok";

const g = globalThis as unknown as { __kpStore?: JsonStore };
// KPCHAT_DATA_FILE: đường dẫn kho khác (để thử với dữ liệu giả, không đụng data/chat.json). Không đặt thì dùng kho mặc định.
export const store = (g.__kpStore ??= new JsonStore(process.env.KPCHAT_DATA_FILE || undefined));

export function boot() {
  initAdapters(store);
  initChatbot(store); // chatbot chỉ soạn nháp khi có tin khách mới (không gửi gì cho khách)
  // Kiểm tra định kỳ token kênh và webhook, ghi nhật ký khi có cảnh báo mới (không chạy khi chạy test)
  if (process.env.NODE_ENV !== "test" && process.env.KPCHAT_ALERT_MONITOR !== "0") startAlertMonitor(store);
  // Sao lưu dữ liệu và ảnh hằng ngày (mặc định sau 3 giờ sáng giờ Việt Nam), tắt bằng KPCHAT_BACKUP=0
  if (process.env.NODE_ENV !== "test" && process.env.KPCHAT_BACKUP !== "0") startBackupSchedule(() => store.snapshot());
  // Zalo cá nhân (zca-js) tắt theo ràng buộc của dự án: không đăng nhập lại số nào
  if (ZALO_PERSONAL_ENABLED) void resumeZaloPersonal(store).catch(() => undefined); // đăng nhập lại các số Zalo cá nhân đã nối (chỉ chạy một lần)
}

export const zaloAdapter = () => getAdapter("zalo_oa") as ReturnType<typeof createZaloAdapter> | undefined;
export const tiktokAdapter = () => getAdapter("tiktok") as ReturnType<typeof createTikTokAdapter> | undefined;

// Địa chỉ công khai của app (Zalo, TikTok, Meta cần HTTPS công khai để gọi webhook và chuyển hướng cấp quyền).
// Đọc theo địa chỉ trình duyệt đang dùng (header Host), không theo req.url: sau proxy của Render, req.url có thể là localhost nội bộ.
export const baseUrl = (req: Request) => publicBase(req.headers, req.url, process.env.KPCHAT_PUBLIC_URL);
// Đăng nhập Facebook quay về: localhost nếu đang mở từ chính máy, còn lại là địa chỉ công khai (xem core/origin.ts)
export const loginBase = (req: Request) => loginBaseOf(req.headers, req.url, process.env.KPCHAT_PUBLIC_URL);

import { NextResponse } from "next/server";
import { actorFromCookie, type Actor } from "@/core/staff";
import { isAdmin } from "@/core/policy";

// Giai đoạn local: người dùng chọn qua cookie (công tắc ở hộp thư). Khi gắn vào KPF thay bằng host adapter.
export const actorOf = (req: Request): Actor => actorFromCookie(req.headers.get("cookie"));
export const forbidden = () => NextResponse.json({ ok: false, error: "Chỉ quản trị mới dùng được chức năng này" }, { status: 403 });
// Trả về Actor nếu là admin, ngược lại trả response 403
export function adminOnly(req: Request): Actor | NextResponse {
  const a = actorOf(req);
  return isAdmin(a) ? a : forbidden();
}
