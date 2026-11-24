// Human Agent của Meta: trả lời khách sau 24 giờ, tối đa 7 ngày kể từ tin cuối của khách, chỉ cho nhân viên thật.
// TẮT mặc định. Chỉ bật (META_HUMAN_AGENT=1) khi Meta đã duyệt quyền Human Agent cho ứng dụng; chưa duyệt mà bật thì Meta từ chối tin.
// File này không import gì của Node để giao diện dùng chung được.
//
// CHƯA XÁC MINH với Meta (tài liệu send-messages chỉ nói "within a 7-day period", không có ví dụ JSON; trang tham chiếu Send API không đọc được):
//   - dạng tin gửi: messaging_type "MESSAGE_TAG" + tag "HUMAN_AGENT" (theo kiến thức đã biết, chưa thấy ví dụ chính thức);
//   - dùng được cho Instagram qua Page (tài liệu nói thẻ "Required for Instagram Messaging API");
//   - dùng được ở chế độ phát triển cho người có vai trò trong app hay chỉ sau duyệt.
// Cách chắc nhất: bật công tắc ở Page thử và gửi một tin quá 24 giờ; nếu Meta từ chối, lỗi sẽ hiện nguyên văn ở khung chat.
export const STANDARD_WINDOW_MS = 24 * 3600_000;
export const HUMAN_AGENT_WINDOW_MS = 7 * 24 * 3600_000;
export const HUMAN_AGENT_TAG = "HUMAN_AGENT" as const;

export const humanAgentEnabled = (env: Record<string, string | undefined> = process.env) => env.META_HUMAN_AGENT === "1";

// open: trong 24 giờ, gửi bình thường. human_agent: quá 24 giờ nhưng chưa quá 7 ngày và công tắc đang bật. closed: không gửi được.
export type MetaWindow = "open" | "human_agent" | "closed";
export function metaWindowState(lastInboundAt: number | undefined, now: number, humanAgent: boolean): MetaWindow {
  if (!lastInboundAt) return "closed";
  const age = now - lastInboundAt;
  if (age <= STANDARD_WINDOW_MS) return "open";
  return humanAgent && age <= HUMAN_AGENT_WINDOW_MS ? "human_agent" : "closed";
}

// Nhắc nhân viên khi đang dùng thẻ Human Agent
export const HUMAN_AGENT_NOTE = "Đã quá 24 giờ: tin này gửi bằng thẻ Human Agent của Meta. Chỉ nội dung hỗ trợ cho vấn đề khách đã hỏi, không quảng cáo, khuyến mãi.";
