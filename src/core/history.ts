// Tải tin cũ của Page (Messenger) hoặc tài khoản Instagram về hộp thư, qua Conversations API của Meta.
// Tin vào kho ở chế độ lịch sử (xem ingest): không chia khách, không tính SLA, không báo chưa đọc, hội thoại mới tạo ở trạng thái "đã xong".
// Chạy lại an toàn: tin đã có thì bỏ qua (mã tin của Graph và của webhook cùng dạng "m_...").
import { localizeMedia } from "./inboundmedia";
import { ingest } from "./ingest";
import { enrichProfiles } from "./profile";
import type { Store } from "./store";
import type { Attachment, Channel, InboundEvent } from "./types";

export interface HistoryJob {
  channelId: string;
  days: number; // 0 = toàn bộ
  status: "running" | "done" | "error" | "stopped";
  startedAt: number;
  finishedAt?: number;
  mode?: "history" | "catchup"; // catchup: khôi phục tin lỡ, ghi như tin mới
  hours?: number; // cửa sổ thời gian của catchup
  conversations: number; // đã duyệt
  stored: number; // tin mới ghi
  duplicates: number; // tin đã có
  error?: string;
}

// Tiến độ nằm trong bộ nhớ của máy chủ (đủ cho bản chạy thử trên máy; khi lên máy chủ thật dùng hàng đợi).
// Để trên globalThis vì chế độ chạy thử của Next nạp lại mô-đun khi sửa file, làm mất bảng nếu để ở biến thường.
const g = globalThis as unknown as { __kpHistory?: { jobs: Map<string, HistoryJob>; cancels: Set<string> } };
const state = (g.__kpHistory ??= { jobs: new Map(), cancels: new Set() });
const { jobs, cancels } = state;
export const getHistoryJob = (channelId: string) => jobs.get(channelId);
export const cancelHistory = (channelId: string) => { if (jobs.get(channelId)?.status === "running") { cancels.add(channelId); return true; } return false; };

export interface HistoryOpts {
  days: number;
  mode?: "history" | "catchup";
  hours?: number; // chỉ với catchup: số giờ gần nhất cần khôi phục

  getToken: (channel: Channel) => Promise<string | null>;
  fetchImpl?: typeof fetch;
  version?: string;
  now?: number;
  maxConversations?: number; // chặn trên để thử nhỏ
  pauseMs?: number; // nghỉ giữa các lần gọi để không dồn Meta
}

interface GConv { id: string; updated_time?: string; participants?: { data?: Array<{ id: string; name?: string; username?: string }> } }
interface GAtt { mime_type?: string; name?: string; file_url?: string; image_data?: { url?: string }; video_data?: { url?: string } }
interface GMsg { id: string; created_time?: string; from?: { id?: string }; message?: string; sticker?: string; attachments?: { data?: GAtt[] } }
interface GPage<T> { data?: T[]; paging?: { next?: string }; error?: { message?: string; code?: number } }

const RATE_CODES = new Set([4, 17, 32, 613]);
const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

function toAttachments(m: GMsg): Attachment[] {
  const out: Attachment[] = [];
  for (const a of m.attachments?.data ?? []) {
    if (a.image_data?.url) out.push({ type: "image", url: a.image_data.url });
    else if (a.video_data?.url) out.push({ type: "video", url: a.video_data.url });
    else if (a.file_url) out.push({ type: a.mime_type?.startsWith("audio/") ? "audio" : "file", url: a.file_url, name: a.name });
  }
  if (m.sticker) out.push({ type: "image", url: m.sticker });
  return out;
}

// Chạy một đợt tải. Cập nhật tiến độ vào bộ nhớ; không ném lỗi ra ngoài.
export async function importHistory(store: Store, channel: Channel, opts: HistoryOpts): Promise<HistoryJob> {
  const existing = jobs.get(channel.id);
  if (existing?.status === "running") return existing;
  const now = opts.now ?? Date.now();
  const job: HistoryJob = { channelId: channel.id, days: opts.days, mode: opts.mode ?? "history", hours: opts.hours, status: "running", startedAt: now, conversations: 0, stored: 0, duplicates: 0 };
  jobs.set(channel.id, job);
  cancels.delete(channel.id);

  const f = opts.fetchImpl ?? fetch;
  const version = opts.version ?? "v27.0";
  const G = `https://graph.facebook.com/${version}`;
  const catchup = opts.mode === "catchup";
  const cutoff = opts.hours && opts.hours > 0 ? now - opts.hours * 3_600_000 : opts.days > 0 ? now - opts.days * 86_400_000 : 0;
  const pageId = channel.kind === "instagram" ? channel.meta?.pageId : channel.externalId;
  const platform = channel.kind === "instagram" ? "instagram" : "messenger";

  try {
    if (!pageId) throw new Error("Kênh chưa có mã Page");
    if (catchup && !cutoff) throw new Error("Khôi phục tin lỡ cần một khoảng thời gian cụ thể");
    const token = await opts.getToken(channel);
    if (!token) throw new Error("Kênh chưa có token, hãy kết nối lại");
    const headers = { authorization: `Bearer ${token}` };

    const get = async <T>(url: string): Promise<GPage<T>> => {
      await sleep(opts.pauseMs ?? 0);
      const res = await f(url, { headers });
      const j = (await res.json().catch(() => ({}))) as GPage<T>;
      if (!res.ok || j.error) {
        const code = j.error?.code;
        if (code !== undefined && RATE_CODES.has(code)) throw new Error("Meta đang giới hạn số lần gọi. Đợi vài phút rồi bấm tải lại, tin đã tải được giữ nguyên.");
        if (code === 190) throw new Error("Token hết hạn hoặc bị thu hồi, hãy đăng nhập Facebook lại để nối lại kênh.");
        if (code === 10 || code === 200) throw new Error("Ứng dụng chưa có quyền đọc hội thoại của Page này (cần pages_messaging và pages_read_engagement).");
        throw new Error(`Meta ${code ?? res.status}: ${j.error?.message ?? "lỗi"}`);
      }
      return j;
    };

    let convUrl: string | undefined = `${G}/${pageId}/conversations?${new URLSearchParams({ platform, fields: "id,updated_time,participants", limit: "25" })}`;
    const msgFields = "id,created_time,from,message,sticker,attachments{id,mime_type,name,size,image_data,video_data,file_url}";
    let stop = false;
    const seen = new Set<string>(); // Meta trả lại trang đã đọc thì dừng, tránh lặp vô hạn

    while (convUrl && !stop) {
      const page: GPage<GConv> = await get<GConv>(convUrl);
      const convs = page.data ?? [];
      // Meta trả hội thoại mới cập nhật trước: gặp hội thoại cũ hơn mốc thì dừng hẳn
      let sawRecent = false;
      for (const c of convs) {
        if (cancels.has(channel.id)) { job.status = "stopped"; stop = true; break; }
        if (opts.maxConversations && job.conversations >= opts.maxConversations) { stop = true; break; }
        const upd = c.updated_time ? Date.parse(c.updated_time) : 0;
        if (cutoff && upd && upd < cutoff) continue;
        sawRecent = true;
        const customer = (c.participants?.data ?? []).find((p) => p.id !== channel.externalId && p.id !== pageId);
        if (!customer) continue;
        const name = (customer.name ?? customer.username)?.trim() || undefined;

        const events: InboundEvent[] = [];
        const seenMsg = new Set<string>();
        let msgUrl: string | undefined = `${G}/${c.id}/messages?${new URLSearchParams({ fields: msgFields, limit: "50" })}`;
        while (msgUrl) {
          const mp: GPage<GMsg> = await get<GMsg>(msgUrl);
          const list = mp.data ?? [];
          let older = false;
          for (const m of list) {
            const at = m.created_time ? Date.parse(m.created_time) : NaN;
            if (!Number.isFinite(at)) continue;
            if (cutoff && at < cutoff) { older = true; continue; }
            const attachments = toAttachments(m);
            if (!m.message && !attachments.length) continue; // phản ứng, tin hệ thống...
            events.push({
              channelExternalId: channel.externalId,
              contact: { externalId: customer.id, name },
              message: { externalId: m.id, direction: m.from?.id === customer.id ? "in" : "out", text: m.message ?? "", attachments, at },
            });
          }
          msgUrl = older ? undefined : mp.paging?.next; // tin mới trước: gặp tin cũ hơn mốc thì dừng
          if (msgUrl && seenMsg.has(msgUrl)) break;
          if (msgUrl) seenMsg.add(msgUrl);
        }
        if (events.length) {
          const r = await ingest(store, channel.kind, events.reverse(), { history: !catchup, catchUp: catchup });
          job.stored += r.stored;
          job.duplicates += r.duplicates;
          if (r.newMedia.length) void localizeMedia(store, r.newMedia).catch(() => undefined); // ảnh của Meta hết hạn: tải về kho ảnh
          if (r.needProfile.length) await enrichProfiles(store, channel.kind, r.needProfile).catch(() => 0); // ảnh đại diện khách (danh sách hội thoại của Meta chỉ có tên)
        }
        job.conversations++;
      }
      if (cutoff && convs.length && !sawRecent) stop = true; // cả trang đều cũ hơn mốc
      convUrl = page.paging?.next;
      if (convUrl && seen.has(convUrl)) break;
      if (convUrl) seen.add(convUrl);
    }
    if (job.status === "running") job.status = "done";
  } catch (e) {
    job.status = "error";
    job.error = e instanceof Error ? e.message : String(e);
  } finally {
    cancels.delete(channel.id);
    job.finishedAt = Date.now();
  }
  return job;
}
