// Hàng đợi cần người: những hội thoại bot đã dừng (chuyển người hoặc đề nghị chuyển người) và đang chờ nhân viên.
// Chỉ đọc từ dữ liệu đã lưu, không gửi gì cho khách và không đổi dữ liệu. Ai thấy hội thoại nào do listConversations quyết (canView).
import { messagesOf, type DB } from "./store";

// Quá bấy nhiêu phút mà chưa ai xử lý thì tô đỏ và hiện ở cảnh báo Tổng quan.
export const NEED_HUMAN_WAIT_MIN = 15;

export interface NeedHuman {
  reason: string; // vì sao bot chuyển người
  since: number; // lúc bot chuyển
  overdue: boolean; // đã chờ quá NEED_HUMAN_WAIT_MIN
  auto: boolean; // bot đã tự ghi chuyển người (chế độ Tự trả lời); false là bot chỉ đề nghị (nháp hoặc gợi ý tham khảo)
}

// Hội thoại cần người khi bản nháp mới nhất của bot là chuyển người (đã ghi hoặc đang đề nghị) và chưa có ai xử lý sau đó:
// người chưa trả lời, chưa tiếp quản, chưa ai bấm Nhận hay được giao tay, hội thoại chưa xong. Khách nhắn thêm vẫn tính là đang chờ.
// Tính một lượt cho mọi hội thoại (hai vòng qua nháp và tin nhắn), trả về theo mã hội thoại.
export function needHumanMap(db: DB, now: number): Map<string, NeedHuman> {
  const out = new Map<string, NeedHuman>();
  const latest = new Map<string, { at: number; status: string; kind: string; reason?: string }>();
  for (const d of Object.values(db.bot?.drafts ?? {})) {
    if (d.status === "stale" || d.status === "error" || d.status === "discarded") continue; // nháp đã bị bỏ: không tính
    const cur = latest.get(d.conversationId);
    if (!cur || d.at > cur.at) latest.set(d.conversationId, d);
  }
  const cand = new Map<string, { at: number; reason: string; auto: boolean }>();
  for (const [convId, d] of latest) {
    const conv = db.conversations[convId];
    if (!conv || conv.status === "resolved") continue;
    if (d.kind !== "handoff" || (d.status !== "handed" && d.status !== "pending")) continue;
    if (conv.botCtl?.off && conv.botCtl.at >= d.at) continue; // nhân viên đã tiếp quản
    if ((conv.botCtl?.resumeAt ?? 0) >= d.at) continue; // nhân viên đã giao lại cho chatbot sau lúc chuyển: coi như đã xử lý
    if (conv.assigneeUid && !conv.autoAssigned && (conv.assignedAt ?? 0) >= d.at) continue; // có người bấm Nhận hoặc được giao tay sau lúc bot chuyển (hệ thống tự chia thì chưa tính)
    cand.set(convId, { at: d.at, reason: (d.reason ?? "").trim() || "Chatbot đề nghị người xử lý", auto: d.status === "handed" });
  }
  if (!cand.size) return out;
  const replied = new Set<string>();
  for (const [convId, c] of cand) {
    if (messagesOf(db, convId).some((m) => m.direction === "out" && !m.internal && !m.bot && m.at >= c.at)) replied.add(convId); // người đã trả lời
  }
  for (const [convId, c] of cand) {
    if (replied.has(convId)) continue;
    out.set(convId, { reason: c.reason, since: c.at, overdue: now - c.at >= NEED_HUMAN_WAIT_MIN * 60_000, auto: c.auto });
  }
  return out;
}
