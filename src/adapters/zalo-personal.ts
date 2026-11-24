// Adapter Zalo cá nhân: không có webhook, tin đến do bộ quản lý phiên (src/core/zalopersonal.ts) nghe và ghi vào kho.
import type { ChannelAdapter } from "@/core/adapter";
import { fetchZaloProfile, sendOut, type ZSource } from "@/core/zalopersonal";
import { loadImageForZalo } from "@/core/zalomedia";

export const zaloPersonalAdapter: ChannelAdapter = {
  id: "zalo_personal",
  replyWindowMs: null, // chat thường: không có cửa sổ trả lời như Messenger hay Zalo OA
  verify: () => false, // không nhận webhook
  parse: () => [],
  fetchProfile: (channel, uid) => fetchZaloProfile(channel, uid),
  async send({ channel, contactExternalId, text, attachments }) {
    const images: ZSource[] = [];
    for (const a of attachments ?? []) {
      if (a.type !== "image") return { ok: false, error: "Zalo cá nhân hiện chỉ gửi được chữ và ảnh jpg/png, chưa gửi được tệp" };
      const r = await loadImageForZalo(a.url);
      if (!r.ok) return { ok: false, error: r.error };
      images.push(r.src);
    }
    if (!text && !images.length) return { ok: false, error: "Tin rỗng" };
    return sendOut(channel, contactExternalId, { text, images });
  },
};
