// Tải tin cũ của một số Zalo cá nhân về hộp thư bằng requestOldMessages của zca-js (không chính thức, giống cách Zalo Web đồng bộ tin).
// Tin vào kho ở chế độ lịch sử (xem ingest): không chia khách, không tính SLA, không báo chưa đọc, hội thoại mới ở trạng thái "đã xong".
// Chạy lại an toàn: tin đã có thì bỏ qua. Giãn cách giữa các lần gọi để giống người dùng thật, không dồn dập.
// CHƯA XÁC MINH với số thật: kích thước một lô, ý nghĩa chính xác của lastMsgId (đang dùng mã tin cũ nhất của lô trước), có cần điện thoại online.
import { ingest } from "./ingest";
import { enrichProfiles } from "./profile";
import type { HistoryJob } from "./history";
import type { Store } from "./store";
import type { Channel, InboundEvent } from "./types";
import { toEvent, zaloLive, type ZMsg } from "./zalopersonal";

const g = globalThis as unknown as { __kpZaloHistory?: { jobs: Map<string, HistoryJob>; cancels: Set<string> } };
const state = (g.__kpZaloHistory ??= { jobs: new Map(), cancels: new Set() });
export const getZaloHistoryJob = (channelId: string) => state.jobs.get(channelId);
export const cancelZaloHistory = (channelId: string) => { if (state.jobs.get(channelId)?.status === "running") { state.cancels.add(channelId); return true; } return false; };

export interface ZaloHistoryOpts {
  days: number; // 0 = tới hết những gì Zalo trả
  pauseMs?: number; // nghỉ giữa các lần xin lô tiếp theo
  pageTimeoutMs?: number; // chờ Zalo trả một lô
  maxPages?: number; // chặn trên mỗi loại hội thoại (1-1, nhóm)
  now?: number;
  profileLimit?: number; // số khách tối đa lấy tên sau khi tải
}

const sleep = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());
const tsOf = (m: ZMsg) => Number(m.data.ts) || 0;

export async function importZaloHistory(store: Store, channel: Channel, opts: ZaloHistoryOpts): Promise<HistoryJob> {
  const existing = state.jobs.get(channel.id);
  if (existing?.status === "running") return existing;
  const now = opts.now ?? Date.now();
  const job: HistoryJob = { channelId: channel.id, days: opts.days, status: "running", startedAt: now, conversations: 0, stored: 0, duplicates: 0 };
  state.jobs.set(channel.id, job);
  state.cancels.delete(channel.id);
  const cutoff = opts.days > 0 ? now - opts.days * 86_400_000 : 0;
  const pauseMs = opts.pauseMs ?? 3000;
  const timeoutMs = opts.pageTimeoutMs ?? 20_000;
  const maxPages = opts.maxPages ?? 200;
  const convs = new Set<string>();
  const needName = new Set<string>(); // mã ngoài của khách chưa biết tên
  const live = zaloLive(channel.id);

  try {
    if (!live) throw new Error("Zalo chưa đăng nhập hoặc đã mất kết nối. Quét QR lại trước khi tải tin cũ.");
    const { api, groups } = live;

    // Xin một lô; chờ sự kiện old_messages cùng loại (0 = chat 1-1, 1 = nhóm). Quá hạn thì trả null.
    const ask = (type: number, lastId: string | null) => new Promise<ZMsg[] | null>((resolve) => {
      const timer = setTimeout(() => { live.setOld(undefined); resolve(null); }, timeoutMs);
      live.setOld((msgs, t) => { if (t !== type) return; clearTimeout(timer); live.setOld(undefined); resolve(msgs); });
      try { api.listener.requestOldMessages(type, lastId); } catch { clearTimeout(timer); live.setOld(undefined); resolve(null); }
    });

    for (const type of groups.size ? [0, 1] : [0]) {
      let lastId: string | null = null;
      let oldest = Infinity;
      for (let page = 0; page < maxPages; page++) {
        if (state.cancels.has(channel.id)) { job.status = "stopped"; break; }
        const batch = await ask(type, lastId);
        if (batch === null) {
          if (page === 0 && job.stored + job.duplicates === 0 && type === 0) throw new Error("Zalo không trả tin cũ (không phản hồi). Thử lại sau, hoặc mở Zalo trên điện thoại cho đồng bộ rồi tải lại.");
          break;
        }
        if (!batch.length) break;
        const events: InboundEvent[] = [];
        for (const m of batch) {
          if (cutoff && tsOf(m) < cutoff) continue;
          const ev = toEvent(channel.externalId, m, groups);
          if (!ev) continue;
          events.push(ev);
          convs.add(ev.contact.externalId);
          if (!ev.contact.name) needName.add(ev.contact.externalId);
        }
        if (events.length) {
          events.sort((a, b) => a.message.at - b.message.at);
          const r = await ingest(store, "zalo_personal", events, { history: true });
          job.stored += r.stored;
          job.duplicates += r.duplicates;
        }
        job.conversations = convs.size;
        const oldestMsg = batch.reduce((a, b) => (tsOf(b) < tsOf(a) ? b : a));
        const t = tsOf(oldestMsg);
        // Hết đường lùi: lô không cũ hơn lô trước, hoặc đã tới mốc ngày, hoặc không có mã để xin tiếp
        if (!(t < oldest) || (cutoff && t < cutoff) || oldestMsg.data.msgId == null) break;
        oldest = t;
        lastId = String(oldestMsg.data.msgId);
        await sleep(pauseMs);
      }
      if (job.status === "stopped") break;
    }

    // Lấy tên khách mới thấy (có giới hạn để không gọi Zalo dồn dập)
    if (job.status === "running" && needName.size) {
      const db = await store.load();
      const need = [...needName].map((ext) => db.contacts[`${channel.id}:${ext}`]).filter((c) => c && c.name === c.externalId).slice(0, opts.profileLimit ?? 50)
        .map((c) => ({ contactId: c.id, channelId: channel.id, externalId: c.externalId }));
      if (need.length) await enrichProfiles(store, "zalo_personal", need).catch(() => 0);
    }
    if (job.status === "running") job.status = "done";
  } catch (e) {
    job.status = "error";
    job.error = e instanceof Error ? e.message : String(e);
  } finally {
    live?.setOld(undefined);
    state.cancels.delete(channel.id);
    job.finishedAt = Date.now();
  }
  return job;
}
