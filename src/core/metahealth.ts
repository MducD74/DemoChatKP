// Kiểm tra nhanh các kênh Messenger và Instagram: token Page còn dùng được không, đủ quyền chưa, Page đã đăng ký nhận tin về app chưa.
// Dùng để hiện "Cần kết nối lại" ở danh sách kênh và băng cảnh báo thay vì chờ đến lúc gửi lỗi.
//
// Cách kiểm token: debug_token bằng token ỨNG DỤNG (appId|appSecret). Endpoint này không đòi quyền gì trên Page, và trả về
// token còn hiệu lực không (is_valid) cùng các quyền đã cấp (scopes). KHÔNG dùng GET /me bằng token Page để kiểm: /me đòi quyền
// pages_read_engagement, nên Page thiếu quyền đó bị báo nhầm là "token không dùng được" dù vẫn nhắn tin được.
// Chỉ coi là token hỏng khi Meta nói rõ: is_valid = false, hoặc mã lỗi 190.
import type { Store } from "./store";
import { staticTokens } from "./token-store";

const GRAPH = "https://graph.facebook.com/v27.0";
export interface ChannelHealth {
  ok: boolean; // false: token hỏng (hết hạn, bị thu hồi) hoặc thiếu quyền nhắn tin: cần Kết nối lại
  error?: string;
  subscribed?: boolean; // Page đã đăng ký app nhận tin (chỉ Messenger)
  missing?: string[]; // quyền nên có mà token chưa có (không chặn nhắn tin), ví dụ pages_read_engagement
  transient?: boolean; // lỗi mạng hoặc Meta tạm lỗi: chưa kết luận được, không báo token hỏng
}

// Quyền bắt buộc để nhắn tin; thiếu thì ok = false
const REQUIRED = ["pages_messaging"];
// Quyền nên có: thiếu thì vẫn nhắn được nhưng mất một phần tính năng
const WANTED: Record<string, string> = {
  pages_read_engagement: "lấy tên và ảnh khách, tải tin cũ",
  pages_manage_metadata: "đăng ký nhận tin cho Page",
};
export const missingNote = (m: string) => WANTED[m] ?? "";

type Dbg = { data?: { is_valid?: boolean; scopes?: string[]; error?: { message?: string; code?: number } }; error?: { message?: string; code?: number } };

export async function checkMetaHealth(store: Store, opts: { appId?: string; appSecret?: string; fetchImpl?: typeof fetch } = {}): Promise<Record<string, ChannelHealth>> {
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
      const h: ChannelHealth = { ok: true };
      if (opts.appId && opts.appSecret) {
        const r = await f(`${GRAPH}/debug_token?${new URLSearchParams({ input_token: token })}`, { headers: { authorization: `Bearer ${opts.appId}|${opts.appSecret}` } });
        const j = (await r.json().catch(() => ({}))) as Dbg;
        if (!r.ok || !j.data) {
          // Không kiểm được (khóa ứng dụng sai, Meta lỗi): không kết luận token hỏng
          out[c.id] = { ok: true, transient: true, error: `Không kiểm được token: ${j.error?.message ?? `Meta trả lỗi ${r.status}`}` };
          return;
        }
        if (j.data.is_valid === false) {
          out[c.id] = { ok: false, error: `Token hết hạn hoặc bị thu hồi${j.data.error?.message ? ` (${j.data.error.message})` : ""}` };
          return;
        }
        const scopes = j.data.scopes;
        if (Array.isArray(scopes)) {
          const lack = REQUIRED.filter((s) => !scopes.includes(s));
          if (lack.length) { out[c.id] = { ok: false, error: `Token thiếu quyền ${lack.join(", ")}: không nhắn tin được` }; return; }
          const miss = Object.keys(WANTED).filter((s) => !scopes.includes(s));
          if (miss.length) h.missing = miss;
        }
      } else {
        // Không có khóa ứng dụng: kiểm bằng /me, nhưng chỉ mã 190 mới là token hỏng
        const r = await f(`${GRAPH}/me?fields=id`, { headers: { authorization: `Bearer ${token}` } });
        const j = (await r.json().catch(() => ({}))) as { id?: string; error?: { message?: string; code?: number } };
        if (!r.ok || !j.id) {
          out[c.id] = j.error?.code === 190
            ? { ok: false, error: "Token hết hạn hoặc bị thu hồi" }
            : { ok: true, transient: true, error: j.error?.message ?? `Meta trả lỗi ${r.status}` };
          return;
        }
      }
      if (c.kind === "facebook" && opts.appId) {
        const s = await f(`${GRAPH}/${pageId}/subscribed_apps`, { headers: { authorization: `Bearer ${token}` } });
        const sj = (await s.json().catch(() => ({}))) as { data?: Array<{ id?: string }>; error?: { code?: number } };
        if (s.ok) h.subscribed = (sj.data ?? []).some((a) => a.id === opts.appId);
        else if (sj.error?.code === 190) { out[c.id] = { ok: false, error: "Token hết hạn hoặc bị thu hồi" }; return; }
      }
      out[c.id] = h;
    } catch (e) {
      out[c.id] = { ok: true, transient: true, error: e instanceof Error ? e.message : "Không gọi được Meta" };
    }
  }));
  return out;
}
