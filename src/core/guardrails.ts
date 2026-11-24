// Ràng buộc bắt buộc của dự án (tài liệu yêu cầu công việc Xuxi Fruit, mục "Ràng buộc bắt buộc").
// Đây là hằng số trong mã, KHÔNG có biến môi trường để bật lại: muốn đổi phải sửa mã và qua duyệt.
//
// 1. Chatbot không tự gửi cho khách. Bot chỉ soạn nháp hoặc gợi ý; nhân viên sửa rồi tự gửi.
// 2. Không nối Zalo cá nhân bằng zca-js (cách nối không chính thức, vi phạm điều khoản Zalo).
import type { BotMode } from "./types";

export const BOT_AUTO_SEND = false as boolean;
export const ZALO_PERSONAL_ENABLED = false as boolean;

export const AUTO_SEND_OFF = "Chatbot không được tự gửi cho khách: chỉ soạn nháp để nhân viên sửa và gửi";
export const ZALO_PERSONAL_OFF = "Zalo cá nhân (zca-js) đã tắt theo ràng buộc của dự án: không nối số Zalo cá nhân";

// Chế độ "auto" (Tự trả lời) cũ được đổi thành Soạn nháp.
export const safeBotMode = (m: BotMode): BotMode => (m === "auto" && !BOT_AUTO_SEND ? "draft" : m);
