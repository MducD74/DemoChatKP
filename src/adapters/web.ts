// Adapter khung chat nhúng trên web: khách nhắn qua API công khai (src/app/api/web), nhân viên và bot trả lời thì tin được ghi vào kho
// và khung chat trên web tự tải về (hỏi định kỳ). Vì vậy "gửi" ở đây chỉ cần báo thành công; không có cửa sổ trả lời.
import type { ChannelAdapter } from "@/core/adapter";

export const webAdapter: ChannelAdapter = {
  id: "web",
  replyWindowMs: null,
  verify: () => false, // không nhận webhook
  parse: () => [],
  async send({ text, attachments }) {
    if (!text && !attachments?.length) return { ok: false, error: "Tin rỗng" };
    return { ok: true, externalId: `web-out-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` };
  },
};
