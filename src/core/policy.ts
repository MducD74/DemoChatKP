// Quy tắc quyền, chạy ở máy chủ. Giao diện chỉ phản ánh kết quả.
// Admin: thấy và làm mọi thứ. Nhân viên: chỉ vào được kênh mình được thêm (mức Nhắn tin hoặc Chỉ xem), trong kênh đó
// chỉ thấy hội thoại của mình và hội thoại chưa nhận (trả lời hoặc ghi chú vào hội thoại chưa nhận thì tự nhận).
import type { Actor } from "./staff";
import type { Channel, Conversation } from "./types";

export const isAdmin = (a: Actor) => a.role === "admin";
export type Level = "send" | "view" | null;

export const levelOn = (a: Actor, ch: Pick<Channel, "access"> | undefined): Level => (isAdmin(a) ? "send" : ch?.access?.[a.uid] ?? null);

const mine = (a: Actor, c: Pick<Conversation, "assigneeUid">) => !c.assigneeUid || c.assigneeUid === a.uid;

export const canView = (a: Actor, c: Pick<Conversation, "assigneeUid">, ch: Pick<Channel, "access"> | undefined) =>
  isAdmin(a) || (levelOn(a, ch) !== null && mine(a, c));

// Ghi (trả lời, ghi chú, đổi tình trạng, nhãn) cần mức Nhắn tin; mức Chỉ xem không ghi được.
export const canAct = (a: Actor, c: Pick<Conversation, "assigneeUid">, ch: Pick<Channel, "access"> | undefined) =>
  isAdmin(a) || (levelOn(a, ch) === "send" && mine(a, c));

// Giao việc: admin giao cho người có mức Nhắn tin ở kênh đó (hoặc bỏ phụ trách); nhân viên chỉ nhận về mình hoặc trả lại hội thoại của mình.
export function canAssign(a: Actor, c: Pick<Conversation, "assigneeUid">, ch: Pick<Channel, "access"> | undefined, target: string | null, targetIsAdmin = false): boolean {
  if (isAdmin(a)) return target === null || targetIsAdmin || ch?.access?.[target] === "send";
  if (!canAct(a, c, ch)) return false;
  return target === a.uid || (target === null && c.assigneeUid === a.uid);
}

export const canManageChannels = isAdmin;
export const canManageTemplates = isAdmin;
export const canSeeOverview = isAdmin;
