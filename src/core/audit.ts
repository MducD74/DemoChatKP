// Nhật ký thao tác (như tab Nhật ký của KP Chat 1): ai làm gì, vào lúc nào, trên hội thoại nào. Chỉ quản trị xem.
import { mutate, type DB, type Store } from "./store";
import type { Actor } from "./staff";
import { isAdmin } from "./policy";

export { DENIED, type AuditRow } from "./auditrow";
import { DENIED, type AuditRow } from "./auditrow";
export const AUDIT_KEEP = 5000; // giữ bấy nhiêu dòng mới nhất
export const AUDIT_SHOW = 400; // tab Nhật ký hiện bấy nhiêu dòng gần nhất
export const OPEN_DEDUPE_MS = 60_000; // mở lại cùng một hội thoại trong vòng này thì không ghi thêm

// Tên dễ đọc của hội thoại: "kênh · tên khách" (KP Chat 1 ghi mã dài, khó đọc)
export function convTarget(db: DB, convId: string): string {
  const c = db.conversations[convId];
  if (!c) return convId;
  return `${db.channels[c.channelId]?.name ?? "Kênh"} · ${db.contacts[c.contactId]?.name || "Khách"}`;
}

// Ghi một dòng vào nhật ký (gọi bên trong mutate). Dòng mới ở đầu danh sách.
export function addAudit(db: DB, actor: Actor, action: string, target?: string, at = Date.now()) {
  const a = (db.audit ??= []);
  a.unshift({ at, uid: actor.uid, who: actor.name, action, ...(target ? { target } : {}) });
  if (a.length > AUDIT_KEEP) a.length = AUDIT_KEEP;
}

// Ghi nhật ký cho hội thoại, kèm tên dễ đọc
export const auditConv = (db: DB, actor: Actor, action: string, convId: string, extra?: string, at = Date.now()) =>
  addAudit(db, actor, action, `${convTarget(db, convId)}${extra ? ` (${extra})` : ""}`, at);

export const auditDenied = (db: DB, actor: Actor, what: string, convId?: string) =>
  addAudit(db, actor, `${DENIED} (không đủ quyền)`, convId ? `${what}: ${convTarget(db, convId)}` : what);

// Mở hội thoại: ghi một dòng, bỏ qua nếu cùng người mở lại cùng hội thoại trong OPEN_DEDUPE_MS
export async function logOpen(store: Store, convId: string, actor: Actor, now = Date.now()): Promise<boolean> {
  return mutate(store, (db) => {
    const c = db.conversations[convId];
    if (!c) return false;
    const target = `${convTarget(db, convId)}${db.contacts[c.contactId]?.phone ? " (xem SĐT)" : ""}`;
    const last = (db.audit ?? []).find((r) => r.uid === actor.uid && r.action === "Mở hội thoại" && r.target === target);
    if (last && now - last.at < OPEN_DEDUPE_MS) return false;
    addAudit(db, actor, "Mở hội thoại", target, now);
    return true;
  });
}

export async function getAudit(store: Store, actor: Actor): Promise<AuditRow[]> {
  if (!isAdmin(actor)) return [];
  return ((await store.load()).audit ?? []).slice(0, AUDIT_SHOW);
}
