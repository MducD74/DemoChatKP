// Kiểm tra nhanh các kênh Messenger và Instagram: token Page còn dùng được không, Page đã đăng ký nhận tin về app chưa.
// Mỗi Page gọi tối đa hai lần Graph API. Dùng để hiện "Cần kết nối lại" ở danh sách kênh thay vì chờ đến lúc gửi lỗi.
import type { Store } from "./store";
import { staticTokens } from "./token-store";

const GRAPH = "https://graph.facebook.com/v27.0";
export interface ChannelHealth { ok: boolean; error?: string; subscribed?: boolean }

export async function checkMetaHealth(store: Store, opts: { appId?: string; fetchImpl?: typeof fetch } = {}): Promise<Record<string, ChannelHealth>> {
  const f = opts.fetchImpl ?? fetch;
  const db = await store.load();
  const tokens = staticTokens(store);
  const out: Record<string, ChannelHealth> = {};
  const channels = Object.values(db.channels).filter((c) => !c.off && (c.kind === "facebook" || c.kind === "instagram"));
  await Promise.all(channels.map(async (c) => {
    const token = await tokens.get(c.id);
    if (!token) return; // chưa có token: trạng thái đã báo ở danh sách
    const pageId = c.meta?.pageId ?? c.externalId;
    try {
      const r = await f(`${GRAPH}/me?fields=id`, { headers: { authorization: `Bearer ${token}` } });
      const j = (await r.json().catch(() => ({}))) as { id?: string; error?: { message?: string; code?: number } };
      if (!r.ok || !j.id) {
        out[c.id] = { ok: false, error: j.error?.code === 190 ? "Token hết hạn hoặc bị thu hồi" : j.error?.message ?? `Meta trả lỗi ${r.status}` };
        return;
      }
      const h: ChannelHealth = { ok: true };
      if (c.kind === "facebook" && opts.appId) {
        const s = await f(`${GRAPH}/${pageId}/subscribed_apps`, { headers: { authorization: `Bearer ${token}` } });
        const sj = (await s.json().catch(() => ({}))) as { data?: Array<{ id?: string }> };
        if (s.ok) h.subscribed = (sj.data ?? []).some((a) => a.id === opts.appId);
      }
      out[c.id] = h;
    } catch (e) {
      out[c.id] = { ok: false, error: e instanceof Error ? e.message : "Không gọi được Meta" };
    }
  }));
  return out;
}
