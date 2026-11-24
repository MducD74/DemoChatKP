// Kho dữ liệu local (JSON) cho giai đoạn dựng. Giao diện Store để sau đổi sang Supabase.
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Channel, Contact, Conversation, Message } from "./types";
import type { BotState } from "./chatbot";
import { safeBotMode } from "./guardrails";

export interface DB {
  channels: Record<string, Channel>;
  contacts: Record<string, Contact>;
  conversations: Record<string, Conversation>;
  messages: Record<string, Message>;
  // Token kênh đã mã hóa, theo channelId (xem token-store.ts)
  secrets?: Record<string, string>;
  // Mẫu trả lời nhanh
  templates?: Record<string, Template>;
  // Thư viện ảnh: thư mục và ảnh
  library?: { folders: string[]; items: Record<string, MediaItem> };
  // Nhân viên đang tạm nghỉ nhận khách tự động (true = tạm nghỉ)
  away?: Record<string, boolean>;
  // Lần cuối nhân viên mở KP Chat (ms), để biết ai đang trực tuyến
  seen?: Record<string, number>;
  // Nhóm kênh của từng người (gộp vài kênh để chọn một lần), theo mã nhân viên; xem channelgroups.ts
  channelGroups?: Record<string, import("./channelgroups").ChannelGroup[]>;
  // Danh mục nhãn (nhóm, màu, hay dùng...); chưa có thì dùng bản mặc định (labels.ts)
  labelCfg?: import("./labels").LabelCfg;
  // Chatbot: cài đặt chung (hướng dẫn, kiến thức) và các nháp của bot (xem chatbot.ts)
  bot?: BotState;
  // Nhật ký thao tác, dòng mới ở đầu (audit.ts)
  audit?: import("./auditrow").AuditRow[];
}

// Mẫu trả lời nhanh (như KP Chat 1.1): ký tự tắt, mỗi mẫu gồm nhiều nội dung gửi lần lượt, mỗi nội dung có chữ và ảnh.
export interface QuickBlock { text: string; images: string[] } // images: mã ảnh trong thư viện
export interface Template {
  id: string;
  key: string; // ký tự tắt: gõ /key để chèn
  blocks: QuickBlock[];
  order: number;
}

export interface MediaItem {
  id: string; // mã ảnh (= tên tệp không đuôi)
  file: string; // tên tệp trong data/media
  name: string;
  folder?: string; // tên thư mục, trống = chưa phân thư mục
  fav?: boolean;
  size: number;
  at: number;
}

export interface Store {
  load(): Promise<DB>;
  save(db: DB): Promise<void>;
  // true: load() luôn trả cùng một đối tượng đang sống trong bộ nhớ (JsonStore). mutate dùng điều này để không phải chờ ghi đĩa
  // xong mới cho lượt sau chạy (lượt sau đọc chính đối tượng đã sửa), nhưng người gọi vẫn chờ tới khi dữ liệu đã nằm trên đĩa.
  readonly live?: boolean;
}

const empty = (): DB => ({ channels: {}, contacts: {}, conversations: {}, messages: {} });

// Sửa dữ liệu cũ cho khớp ràng buộc hiện tại (chạy một lần lúc nạp kho).
export function normalizeDb(db: DB): DB {
  for (const b of Object.values(db.bot?.bots ?? {})) b.mode = safeBotMode(b.mode);
  return db;
}

// Kho JSON giữ toàn bộ dữ liệu trong bộ nhớ (chỉ đọc tệp một lần), ghi xuống đĩa an toàn:
// ghi tệp tạm, fsync, đổi tên (nguyên tử), nên máy tắt giữa chừng vẫn còn bản cũ hoặc bản mới nguyên vẹn, không có tệp hỏng.
// Nhiều lượt ghi dồn dập được gộp thành một lần ghi. Chỉ dùng được với MỘT tiến trình máy chủ (Railway: một bản chạy).
export class JsonStore implements Store {
  readonly live = true;
  private db?: DB;
  private loading?: Promise<DB>;
  private writing: Promise<void> | null = null;
  private queued: Promise<void> | null = null;
  constructor(private file: string = path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "chat.json")) {}

  async load(): Promise<DB> {
    if (this.db) return this.db;
    this.loading ??= this.read().then((d) => (this.db = d));
    return this.loading;
  }

  private async read(): Promise<DB> {
    let text: string;
    try {
      text = await fs.readFile(/*turbopackIgnore: true*/ this.file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return empty();
      throw e;
    }
    // Tệp hỏng thì KHÔNG trả kho rỗng (sẽ ghi đè mất dữ liệu): báo lỗi để người vận hành khôi phục từ bản sao lưu.
    return normalizeDb({ ...empty(), ...JSON.parse(text) });
  }

  save(db: DB): Promise<void> {
    this.db = db;
    bumpVersion(db);
    // Đã có một lần ghi đang chờ bắt đầu: lần đó sẽ ghi cả thay đổi này
    if (this.queued) return this.queued;
    // Phần thân chạy ở microtask sau (qua .then), nên this.queued luôn được gán trước khi bị xóa
    const run = (this.writing ?? Promise.resolve()).catch(() => undefined).then(async () => {
      this.queued = null;
      const w = this.write(JSON.stringify(this.db));
      this.writing = w;
      try { await w; } finally { if (this.writing === w) this.writing = null; }
    });
    this.queued = run;
    return run;
  }

  private async write(text: string) {
    await fs.mkdir(/*turbopackIgnore: true*/ path.dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    const fh = await fs.open(/*turbopackIgnore: true*/ tmp, "w");
    try {
      await fh.writeFile(text);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fs.rename(/*turbopackIgnore: true*/ tmp, this.file);
  }

  // Nội dung kho tại lúc này, sau khi mọi lần ghi đang dở đã xong (dùng để sao lưu trong máy chủ)
  async snapshot(): Promise<string> {
    await this.flush();
    return JSON.stringify(await this.load());
  }

  // Chờ mọi lần ghi đang dở xong (dùng khi tắt máy chủ, sao lưu)
  async flush() {
    while (this.queued || this.writing) await (this.queued ?? this.writing)?.catch(() => undefined);
  }
}

// ---------- Phiên bản dữ liệu và chỉ mục tin theo hội thoại ----------
const versions = new WeakMap<DB, number>();
const bumpVersion = (db: DB) => versions.set(db, (versions.get(db) ?? 0) + 1);
type MsgIndex = { v: number; n: number; byConv: Map<string, Message[]> };
const indexes = new WeakMap<Record<string, Message>, MsgIndex>();

// Tin của từng hội thoại (gồm cả ghi chú nội bộ), xếp theo thời gian. Dựng lại khi dữ liệu đổi; giữa hai lần ghi thì dùng lại.
// Không được sửa mảng trả về.
export function messagesByConv(db: DB): Map<string, Message[]> {
  const v = versions.get(db) ?? 0;
  const n = Object.keys(db.messages).length;
  const cur = indexes.get(db.messages);
  if (cur && cur.v === v && cur.n === n) return cur.byConv;
  const byConv = new Map<string, Message[]>();
  for (const m of Object.values(db.messages)) {
    const arr = byConv.get(m.conversationId);
    if (arr) arr.push(m); else byConv.set(m.conversationId, [m]);
  }
  for (const arr of byConv.values()) arr.sort((a, b) => a.at - b.at);
  indexes.set(db.messages, { v, n, byConv });
  return byConv;
}
const NONE: Message[] = [];
export const messagesOf = (db: DB, convId: string): Message[] => messagesByConv(db).get(convId) ?? NONE;

// Mọi thao tác "đọc, sửa, ghi" phải đi qua mutate: các lượt được xếp hàng nên không ghi chồng làm mất tin.
// Người gọi chỉ nhận kết quả khi dữ liệu đã ghi xuống đĩa (webhook trả 200 sau đó, nên máy chủ tắt đột ngột thì nền tảng gửi lại).
const tails = new WeakMap<Store, Promise<unknown>>();
export async function mutate<T>(store: Store, fn: (db: DB) => T | Promise<T>): Promise<T> {
  const prev = tails.get(store) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(async () => {
    const db = await store.load();
    const out = await fn(db);
    bumpVersion(db);
    const saved = store.save(db);
    // Kho sống trong bộ nhớ: lượt sau được chạy ngay (đọc đối tượng đã sửa), việc ghi đĩa được gộp. Kho khác: chờ ghi xong.
    if (!store.live) await saved;
    return { out, saved };
  });
  tails.set(store, run);
  const { out, saved } = await run;
  await saved;
  return out;
}
