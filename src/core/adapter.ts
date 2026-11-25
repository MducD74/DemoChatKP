import type { Channel, InboundEvent, Attachment } from "./types";

export interface SendInput {
  channel: Channel;
  contactExternalId: string;
  text?: string;
  attachments?: Attachment[];
  // mã hội thoại phía kênh (nếu kênh gửi theo hội thoại, như TikTok)
  conversationExternalId?: string;
  // thời điểm tin cuối của khách, để kiểm cửa sổ trả lời
  lastInboundAt?: number;
  // Thẻ gửi ngoài cửa sổ chuẩn (Meta Human Agent). Chỉ do lõi gửi tin đặt, khi nhân viên thật gửi trong cửa sổ mở rộng.
  messageTag?: "HUMAN_AGENT";
  // Thời điểm tính cửa sổ (mặc định giờ hiện tại); cùng mốc với lõi gửi tin để hai bên kiểm giống nhau
  now?: number;
}

export interface SendResult {
  ok: boolean;
  externalId?: string;
  error?: string;
  // Kênh tách một lần gửi thành nhiều tin (Meta: chữ và từng ảnh là tin riêng, mỗi tin một mã). Có thì lõi lưu từng phần với đúng mã,
  // để echo của từng phần khớp và không bị nhân đôi.
  parts?: Array<{ externalId: string; text?: string; attachment?: Attachment }>;
}

// Mỗi kênh (meta, zalo-oa, tiktok) cài giao diện này.
export interface ChannelAdapter {
  readonly id: string;
  // Xác thực webhook (chữ ký, token xác minh). Trả false thì gateway từ chối.
  verify(headers: Headers, rawBody: string): boolean;
  // Đổi payload của kênh thành sự kiện chuẩn hóa. Có thể trả nhiều sự kiện.
  parse(payload: unknown): InboundEvent[];
  send(input: SendInput): Promise<SendResult>;
  // Bước xác minh GET khi đăng ký webhook (Meta). Trả nội dung phản hồi, hoặc null để trả 403.
  challenge?(params: URLSearchParams): string | null;
  // Lấy tên và ảnh của khách từ kênh. Trả null nếu kênh không cho hoặc lỗi. Không cần thì bỏ.
  // error: lý do kênh không trả hồ sơ (để hiện cho quản trị), không có tên và ảnh thì trả null hoặc chỉ error
  fetchProfile?(channel: Channel, contactExternalId: string): Promise<{ name?: string; avatarUrl?: string; error?: string } | null>;
  // Với kênh có token hết hạn (Zalo OA). Không cần thì bỏ.
  refreshToken?(channel: Channel): Promise<void>;
  // Giờ cho phép trả lời sau tin cuối của khách, null nếu không giới hạn.
  replyWindowMs: number | null;
  // Cửa sổ mở rộng dành cho nhân viên thật (Meta Human Agent: 7 ngày), tính tại thời điểm gọi vì có công tắc cấu hình. null hoặc bỏ = không có.
  extendedWindowMs?: () => number | null;
  // Số tin tối đa được gửi trong một cửa sổ trả lời (kể từ tin cuối của khách). Không giới hạn thì bỏ.
  maxRepliesPerWindow?: number;
}

const registry = new Map<string, ChannelAdapter>();
export const registerAdapter = (a: ChannelAdapter) => void registry.set(a.id, a);
export const getAdapter = (id: string) => registry.get(id);
