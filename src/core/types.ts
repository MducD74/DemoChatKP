// Kiểu dữ liệu chung của KP Chat 2.0. Mọi kênh đổi về các kiểu này.

export type ChannelKind = "facebook" | "instagram" | "zalo_oa" | "zalo_personal" | "tiktok" | "web";

export interface Channel {
  id: string; // id nội bộ
  companyId: string;
  kind: ChannelKind;
  externalId: string; // pageId / oaId / ...
  name: string;
  sendEnabled: boolean; // công tắc gửi tin, mặc định false
  off?: boolean;
  // Thông tin riêng của kênh. Instagram: pageId của Page liên kết (dùng để gửi tin; externalId là id tài khoản Instagram).
  meta?: Record<string, string>;
  // Phân quyền theo kênh: nhân viên nào được vào kênh và mức nào. Không có ai thì chỉ quản trị thấy kênh này.
  access?: Record<string, "send" | "view">;
  // SLA của kênh. Chưa cài thì kênh này không đo và không cảnh báo SLA (không có mặc định).
  sla?: SlaCfg;
  // Chia khách tự động. Không đặt hoặc mode "manual" thì nhân viên tự bấm Nhận khách.
  routing?: RoutingCfg;
}

// off: tắt. shadow: soạn âm thầm để đo, nhân viên không thấy. draft: hiện nháp cho nhân viên duyệt.
// auto: bot tự gửi (chỉ khi quản trị bật cho chatbot; không bao giờ ở Zalo cá nhân).
export type BotMode = "off" | "shadow" | "draft" | "auto";

export type RoutingMode = "manual" | "round_robin" | "least_busy" | "fixed";
export interface RoutingCfg {
  mode: RoutingMode;
  pool?: string[]; // chỉ chia cho các người này (phải có mức Nhắn tin ở kênh); trống = mọi người có mức Nhắn tin
  fixedUid?: string; // mode "fixed": luôn giao cho người này
  maxOpen?: number; // mỗi người giữ tối đa bấy nhiêu hội thoại đang mở ở kênh này; không đặt thì không giới hạn
  hours?: { days: number[]; start: string; end: string }; // chỉ chia trong giờ làm việc; ngoài giờ để chưa nhận
  sticky?: boolean; // khách quay lại thì ưu tiên giao lại cho người từng phụ trách
  weights?: Record<string, number>; // tỷ lệ chia: người có số lớn hơn nhận nhiều hơn (1 đến 10); không ghi thì tính 1
  preferOnline?: boolean; // ưu tiên người đang trực tuyến; không ai trực tuyến thì chia đều cho những người còn lại
  escalateMin?: number; // khách chờ quá số phút này mà người được chia tự động chưa trả lời thì chuyển cho người khác (một lần cho mỗi tin của khách)
  cursor?: number; // vị trí xoay vòng (hệ thống tự cập nhật)
}

export interface SlaCfg {
  firstResponseMin: number; // ngưỡng phản hồi, phút (tính theo giờ làm việc nếu có đặt)
  missedMin?: number; // khách chờ quá số phút này thì tính là bỏ lỡ; không đặt thì không đếm bỏ lỡ
  hours?: { days: number[]; start: string; end: string }; // giờ làm việc: thứ 1 (T2) đến 7 (CN), giờ Việt Nam "HH:MM"
  perUser?: Record<string, number>; // ngưỡng riêng cho từng sale (phút), ghi đè ngưỡng của kênh
}

export interface Contact {
  id: string;
  companyId: string;
  channelId: string;
  externalId: string; // psid / zalo uid / ...
  name: string;
  phone?: string;
  address?: string; // địa chỉ khách (nhân viên nhập ở ô thông tin bên phải)
  area?: string; // phường, khu vực
  avatarUrl?: string;
  lang?: string; // ngôn ngữ khách đang dùng (khung chat trên web báo: vi, en, ko, zh, ru) để chatbot trả lời cùng ngôn ngữ
  profileAt?: number; // lần cuối thử lấy tên và ảnh từ kênh (để không gọi lại liên tục)
}

export type Direction = "in" | "out";

export interface Attachment {
  type: "image" | "file" | "audio" | "video" | "sticker" | "other";
  url: string;
  name?: string;
}

export interface Message {
  id: string;
  companyId: string;
  conversationId: string;
  externalId: string; // id tin của kênh, dùng chống trùng
  direction: Direction;
  text: string;
  attachments: Attachment[];
  at: number; // ms epoch
  senderUid?: string; // nhân viên KPF khi direction = out
  internal?: boolean; // ghi chú nội bộ: chỉ nhân viên thấy, không gửi cho khách
  history?: boolean; // tải về từ lịch sử của kênh: không tính SLA và thống kê
  bot?: boolean; // tin do chatbot tự gửi (chế độ tự trả lời): không tính là người trả lời trong SLA
}

export type ConvStatus = "open" | "pending" | "snoozed" | "resolved";

// Việc cần làm gắn với hội thoại (ví dụ gọi báo giá). Khi nối KPF sẽ ánh xạ sang KP Tasks.
export type TaskPriority = "high" | "med" | "low";
export interface ConvTask { id: string; text: string; due?: string; time?: string; priority?: TaskPriority; owner?: string; note?: string; done?: boolean; by: string; at: number }
// Lịch sử thao tác của hội thoại: giao khách, đổi giai đoạn, nhãn, sửa thông tin...
export interface ConvLog { at: number; by?: string; text: string }

export interface Conversation {
  id: string;
  companyId: string;
  channelId: string;
  contactId: string;
  brandId?: string; // thương hiệu của kênh lúc hội thoại được tạo (brands.ts); gắn cố định để báo cáo theo thương hiệu không lẫn khi kênh đổi thương hiệu
  assigneeUid?: string;
  status: ConvStatus;
  labels: string[];
  escalatedFor?: number; // tin khách (lastInboundAt) đã được chuyển tiếp rồi, để không chuyển lặp
  autoAssigned?: boolean; // được hệ thống tự chia (không phải người bấm Nhận hay admin giao)
  lastAssigneeUid?: string; // người phụ trách gần nhất trước khi bỏ phụ trách (để giao lại cho khách quay lại)
  assignedAt?: number; // lúc được giao hoặc nhận lần gần nhất (để đo thời gian nhận khách)
  readBy?: Record<string, number>; // thời điểm mỗi nhân viên đọc lần cuối
  externalId?: string; // mã hội thoại phía kênh (TikTok cần mã này để gửi tin)
  lastInboundAt?: number;
  lastInboundHistory?: boolean; // tin khách cuối là tin lịch sử tải về: không tính là chưa đọc
  // Điều khiển chatbot của hội thoại: off = nhân viên đã dừng bot (tiếp quản); resumeAt = giao lại cho bot, tin người trả lời trước mốc này không làm bot dừng
  botCtl?: { off?: boolean; resumeAt?: number; by?: string; at: number };
  lastMessageAt?: number;
  // Chatbot phụ trách hội thoại do nhân viên chọn (xem botassign.ts): none = không dùng bot; botId = dùng chatbot này thay vì tự chọn theo kênh và loại khách;
  // withStaff = bot vẫn trả lời khi đã có nhân viên phụ trách (nhân viên trả lời thì bot vẫn tạm dừng như thường)
  typingAt?: number; // lần cuối nhân viên báo đang gõ trong ô soạn: chatbot chờ một lúc để không gửi chen (xem botauto.ts)
  botSel?: { botId?: string; none?: boolean; withStaff?: boolean; by: string; at: number };
  stage?: string; // giai đoạn tư vấn (xem convmeta.ts)
  stageAt?: number;
  lostReason?: string; // lý do khi giai đoạn là Mất/Spam
  tasks?: ConvTask[];
  log?: ConvLog[];
}

// Sự kiện đã chuẩn hóa từ webhook của một kênh.
export interface InboundEvent {
  channelExternalId: string;
  conversationExternalId?: string;
  contact: { externalId: string; name?: string; phone?: string; avatarUrl?: string };
  message: { externalId: string; direction: Direction; text: string; attachments: Attachment[]; at: number };
}
