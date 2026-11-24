// Lịch sử của một chatbot: các nháp và tin chatbot đã soạn gần đây (mới nhất trước), để quản trị xem chatbot đã nói gì và nhân viên xử lý ra sao.
// Chỉ đọc. Không có đường gửi tin.
import type { DB } from "./store";
import type { BotDraft } from "./chatbot";

export interface HistoryRow {
  id: string; at: number; status: BotDraft["status"]; kind: BotDraft["kind"]; shadow: boolean; asked: boolean;
  text: string; reason?: string; conversationId: string; contact: string; channel: string;
}
export const HISTORY_LIMIT = 40;
const SNIPPET = 220;

export function botHistory(db: DB, botId: string, limit = HISTORY_LIMIT): HistoryRow[] {
  const rows: HistoryRow[] = [];
  for (const d of Object.values(db.bot?.drafts ?? {})) {
    if (d.botId !== botId) continue;
    const conv = db.conversations[d.conversationId];
    rows.push({
      id: d.id, at: d.at, status: d.status, kind: d.kind, shadow: !!d.shadow, asked: !!d.asked,
      text: (d.text ?? "").slice(0, SNIPPET), ...(d.reason ? { reason: d.reason.slice(0, SNIPPET) } : {}),
      conversationId: d.conversationId,
      contact: (conv && db.contacts[conv.contactId]?.name) || "Khách",
      channel: db.channels[d.channelId]?.name ?? "(kênh đã gỡ)",
    });
  }
  return rows.sort((a, b) => b.at - a.at).slice(0, Math.max(1, Math.min(limit, 200)));
}
