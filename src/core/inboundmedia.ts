// Ảnh khách gửi qua Messenger/Instagram chỉ là đường dẫn CDN của Meta, sẽ hết hạn sau một thời gian. Sau khi ghi tin, tải ảnh về
// kho ảnh của KP Chat (data/media) và đổi đường dẫn của tin sang /api/media/<mã>, để ảnh còn xem được lâu dài và có trong bản sao lưu.
// Chạy sau khi đã trả lời webhook; lỗi thì giữ đường dẫn gốc, không làm hỏng việc nhận tin.
// Chống SSRF: chỉ tải https từ máy chủ ảnh của Meta, không theo chuyển hướng sang máy khác, giới hạn dung lượng và thời gian.
import { mutate, type Store } from "./store";
import { saveVisitorImage } from "./media";

export const MEDIA_HOSTS = [/(^|\.)fbcdn\.net$/, /(^|\.)fbsbx\.com$/, /(^|\.)cdninstagram\.com$/, /(^|\.)facebook\.com$/];
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

export const allowedMediaUrl = (u: string) => {
  try {
    const x = new URL(u);
    return x.protocol === "https:" && MEDIA_HOSTS.some((r) => r.test(x.hostname));
  } catch {
    return false;
  }
};

export interface PendingMedia { messageId: string; index: number; url: string }

async function download(url: string, f: typeof fetch): Promise<Uint8Array | null> {
  let cur = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!allowedMediaUrl(cur)) return null;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const r = await f(cur, { redirect: "manual", signal: ctl.signal });
      if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { cur = new URL(r.headers.get("location")!, cur).href; continue; }
      if (!r.ok || !r.body) return null;
      if (Number(r.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
      const chunks: Uint8Array[] = [];
      let n = 0;
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        n += value.byteLength;
        if (n > MAX_BYTES) { await reader.cancel(); return null; }
        chunks.push(value);
      }
      return Buffer.concat(chunks);
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  }
  return null;
}

export async function localizeMedia(store: Store, items: PendingMedia[], f: typeof fetch = fetch): Promise<number> {
  let done = 0;
  for (const it of items) {
    if (!allowedMediaUrl(it.url)) continue;
    const bytes = await download(it.url, f);
    if (!bytes) continue;
    const saved = await saveVisitorImage(bytes); // kiểm định dạng thật (jpg, png, webp) và dung lượng
    if (!saved.ok) continue;
    const ok = await mutate(store, (db) => {
      const a = db.messages[it.messageId]?.attachments[it.index];
      if (!a || a.url !== it.url) return false;
      a.url = `/api/media/${saved.id}`;
      return true;
    });
    if (ok) done++;
  }
  return done;
}
