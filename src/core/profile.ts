// Lấy tên và ảnh khách từ kênh rồi ghi vào danh bạ. Chạy sau khi đã trả lời webhook, không được làm hỏng việc nhận tin.
import { getAdapter } from "./adapter";
import { mutate, type Store } from "./store";
import type { IngestResult } from "./ingest";

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
      if (p?.name) ct.name = p.name;
      if (p?.avatarUrl) ct.avatarUrl = p.avatarUrl;
      if (p?.name || p?.avatarUrl) updated++;
    });
  }
  return updated;
}
