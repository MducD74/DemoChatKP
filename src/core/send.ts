// Gửi tin: kiểm công tắc gửi, cửa sổ trả lời và hạn mức số tin trước khi gọi adapter kênh.
import { getAdapter, type SendResult } from "./adapter";
import type { Attachment, Channel } from "./types";
import { AUTO_SEND_OFF, BOT_AUTO_SEND } from "./guardrails";

export async function sendMessage(input: {
  channel: Channel;
  contactExternalId: string;
  conversationExternalId?: string;
  text?: string;
  attachments?: Attachment[];
  lastInboundAt?: number;
  // số tin đã gửi kể từ tin cuối của khách (để kiểm hạn mức mỗi cửa sổ)
  repliesSinceInbound?: number;
  now?: number;
  // Tin do máy (chatbot) gửi: không bao giờ được dùng cửa sổ mở rộng Human Agent (chỉ dành cho nhân viên thật).
  automated?: boolean;
}): Promise<SendResult> {
  const { channel } = input;
  // Ràng buộc dự án: máy (chatbot) không bao giờ tự gửi cho khách
  if (input.automated && !BOT_AUTO_SEND) return { ok: false, error: AUTO_SEND_OFF };
  if (!channel.sendEnabled) return { ok: false, error: "Kênh đang tắt gửi tin" };
  const adapter = getAdapter(channel.kind);
  if (!adapter) return { ok: false, error: `Chưa có adapter cho ${channel.kind}` };
  const now = input.now ?? Date.now();
  let messageTag: "HUMAN_AGENT" | undefined;
  if (adapter.replyWindowMs != null) {
    if (!input.lastInboundAt || now - input.lastInboundAt > adapter.replyWindowMs) {
      // Quá cửa sổ chuẩn: chỉ nhân viên thật được gửi tiếp, và chỉ khi kênh có cửa sổ mở rộng đang bật và chưa quá hạn.
      const ext = input.automated ? null : adapter.extendedWindowMs?.() ?? null;
      if (!input.lastInboundAt || ext == null || now - input.lastInboundAt > ext) {
        return { ok: false, error: "Quá cửa sổ trả lời của kênh" };
      }
      messageTag = "HUMAN_AGENT";
    }
  }
  const need = (input.text ? 1 : 0) + (input.attachments?.length ?? 0);
  if (adapter.maxRepliesPerWindow != null && (input.repliesSinceInbound ?? 0) + need > adapter.maxRepliesPerWindow) {
    return { ok: false, error: `Kênh chỉ cho gửi tối đa ${adapter.maxRepliesPerWindow} tin sau mỗi tin của khách` };
  }
  return adapter.send({
    channel,
    contactExternalId: input.contactExternalId,
    conversationExternalId: input.conversationExternalId,
    text: input.text,
    attachments: input.attachments,
    lastInboundAt: input.lastInboundAt,
    now,
    ...(messageTag ? { messageTag } : {}),
  });
}
