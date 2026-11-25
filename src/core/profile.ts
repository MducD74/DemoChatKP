// Lấy tên và ảnh khách từ kênh rồi ghi vào danh bạ. Chạy sau khi đã trả lời webhook, không được làm hỏng việc nhận tin.
import { getAdapter } from "./adapter";
import { mutate, type Store } from "./store";
import type { IngestResult } from "./ingest";
import { canView } from "./policy";
import type { Actor } from "./staff";

export async function enrichProfiles(store: Store, kind: string, need: IngestResult["needProfile"]): Promise<number> {
  const adapter = getAdapter(kind);
  if (!adapter?.fetchProfile || !need.length) return 0;
  let updated = 0;
  for (const n of need) {
    const ch = (await store.load()).channels[n.channelId];
    if (!ch) continue;
    const p = await adapter.fetchProfile(ch, n.externalId).catch(() => null);
    await mutate(store, (db) => {
      const ct = db.contacts[n.contactId];
      if (!ct) return;
      ct.profileAt = Date.now(); // ghi cả khi lỗi để không gọi lại liên tục
      if (p?.name && ct.name === ct.externalId) ct.name = p.name; // chỉ điền khi chưa có tên thật: không đè tên kênh đã gửi kèm tin
      if (p?.avatarUrl) ct.avatarUrl = p.avatarUrl;
      if (p?.name || p?.avatarUrl) updated++;
    });
  }
  return updated;
}

// Quản trị hoặc nhân viên xem được hội thoại bấm "Lấy lại ảnh": gọi kênh ngay (bỏ qua giới hạn mỗi giờ một lần) và trả lý do nếu kênh không trả.
export async function refreshProfile(store: Store, convId: string, actor: Actor): Promise<{ ok: true; avatarUrl?: string; name: string } | { ok: false; error: string }> {
  const db = await store.load();
  const conv = db.conversations[convId];
  const ch = conv && db.channels[conv.channelId];
  if (!conv || !ch || !canView(actor, conv, ch)) return { ok: false, error: "Không tìm thấy hội thoại" };
  const ct = db.contacts[conv.contactId];
  const adapter = getAdapter(ch.kind);
  if (!ct || !adapter?.fetchProfile) return { ok: false, error: "Kênh này không hỗ trợ lấy hồ sơ khách" };
  type P = { name?: string; avatarUrl?: string; error?: string } | null;
  const p: P = await adapter.fetchProfile(ch, ct.externalId).catch((e): P => ({ error: e instanceof Error ? e.message : "Lỗi khi gọi kênh" }));
  const out = await mutate(store, (d) => {
    const c = d.contacts[ct.id];
    if (!c) return null;
    c.profileAt = Date.now();
    if (p?.name && c.name === c.externalId) c.name = p.name;
    if (p?.avatarUrl) c.avatarUrl = p.avatarUrl;
    return { name: c.name, avatarUrl: c.avatarUrl };
  });
  if (!out) return { ok: false, error: "Không tìm thấy khách" };
  if (!p?.avatarUrl) return { ok: false, error: p?.error ?? "Kênh không trả ảnh của khách này" };
  return { ok: true, ...out };
}
