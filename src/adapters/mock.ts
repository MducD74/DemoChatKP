// Adapter giả để dựng và thử gateway, không gọi mạng. Payload: { page, user, name, mid, text, ts }.
import type { ChannelAdapter } from "@/core/adapter";
import type { InboundEvent } from "@/core/types";

export const sent: Array<{ to: string; text?: string }> = [];

export const mockAdapter: ChannelAdapter = {
  id: "facebook",
  replyWindowMs: 24 * 3600 * 1000,
  verify: (h) => h.get("x-mock-secret") === (process.env.MOCK_SECRET ?? "dev"),
  parse(payload): InboundEvent[] {
    const p = payload as { page: string; user: string; name?: string; mid: string; text?: string; ts?: number };
    if (!p?.page || !p?.user || !p?.mid) return [];
    return [
      {
        channelExternalId: p.page,
        contact: { externalId: p.user, name: p.name },
        message: { externalId: p.mid, direction: "in", text: p.text ?? "", attachments: [], at: p.ts ?? Date.now() },
      },
    ];
  },
  async send({ contactExternalId, text }) {
    sent.push({ to: contactExternalId, text });
    return { ok: true, externalId: `mock-${sent.length}` };
  },
};
