// Xem thử chatbot ngay trên trang cấu hình: trò chuyện thử với cấu hình ĐANG SỬA (chưa cần lưu).
// Ràng buộc: chỉ gọi mô hình và trả chữ về cho quản trị. KHÔNG tạo hội thoại, KHÔNG ghi nháp, KHÔNG gửi tin cho ai (không import send hay service).
// Dùng cùng lời nhắc (buildSystem) và cùng luật chuyển người cứng như chatbot thật, nên thử ở đây giống thật.
import type { DB } from "./store";
import { BOT_MODELS, DEFAULT_BOT_MODEL, getModelProvider, type ModelProvider } from "./botmodel";
import { LIMITS, TONES, botSettings, buildSystem, handoffReason, parseReply, type BotCfg, type BotType } from "./chatbot";
import type { BotMode } from "./types";
import type { Channel, Message } from "./types";

export const PREVIEW_LIMITS = { turns: 16, content: 1000, perHour: 60 };
export interface PreviewMsg { role: "user" | "assistant"; content: string }
export interface PreviewInput { botId?: unknown; form?: unknown; messages?: unknown }
export type PreviewOut =
  | { ok: true; kind: "reply"; text: string; note?: string; usage?: { input: number; output: number } }
  | { ok: true; kind: "handoff"; reason: string; usage?: { input: number; output: number } }
  | { ok: false; error: string };

// Hạn mức mỗi giờ cho cả máy chủ (chặn vòng lặp lỡ tay gọi liên tục).
let window_: { start: number; n: number } = { start: 0, n: 0 };
export const resetPreviewBudget = () => { window_ = { start: 0, n: 0 }; };
function takeBudget(now: number): boolean {
  if (now - window_.start >= 3_600_000) window_ = { start: now, n: 0 };
  if (window_.n >= PREVIEW_LIMITS.perHour) return false;
  window_.n++;
  return true;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

// Dựng cấu hình tạm từ form đang sửa; giá trị lạ thì dùng mặc định. Không ghi gì.
export function previewCfg(db: DB, botId: unknown, form: unknown): BotCfg {
  const f = (form && typeof form === "object" ? form : {}) as Record<string, unknown>;
  const known = new Set(botSettings(db).docs.map((d) => d.id));
  const saved = typeof botId === "string" && botId ? db.bot?.bots?.[botId] : undefined;
  const type: BotType = f.type === "care" ? "care" : "new";
  const brandId = saved?.brandId ?? (typeof f.brandId === "string" && (db.bot?.brands ?? []).some((b) => b.id === f.brandId) ? f.brandId : undefined); // xem thử dùng đúng hồ sơ và bộ lọc tài liệu của thương hiệu
  const mode: BotMode = f.mode === "auto" ? "auto" : "draft"; // chế độ chỉ đổi câu mở đầu lời nhắc; xem thử không bao giờ gửi
  return {
    id: saved?.id ?? "preview", name: str(f.name, LIMITS.name) || saved?.name || "Chatbot thử", type, channelIds: Array.isArray(f.channelIds) ? f.channelIds.map(String).filter((c) => db.channels[c]) : saved?.channelIds ?? [],
    mode, tone: str(f.tone, LIMITS.tone) || TONES[0], instructions: str(f.instructions, LIMITS.instructions),
    docIds: Array.isArray(f.docIds) ? [...new Set(f.docIds.map(String))].filter((d) => known.has(d)) : saved?.docIds ?? [],
    useTemplates: f.useTemplates !== false, model: BOT_MODELS.some(([m]) => m === f.model) ? String(f.model) : DEFAULT_BOT_MODEL,
    intro: "", at: saved?.at ?? 0, ...(brandId ? { brandId } : {}), ...(f.adviceInline === true ? { adviceInline: true } : {}),
  } as BotCfg;
}

// Làm sạch lịch sử trò chuyện thử: tối đa PREVIEW_LIMITS.turns lượt, gộp lượt liền nhau cùng vai, phải kết thúc bằng lượt của khách.
export function cleanMessages(raw: unknown): PreviewMsg[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return "Chưa có tin nào để thử";
  if (raw.length > PREVIEW_LIMITS.turns) return `Cuộc thử tối đa ${PREVIEW_LIMITS.turns} lượt. Bấm làm mới để thử lại từ đầu`;
  const out: PreviewMsg[] = [];
  for (const m of raw as Array<Partial<PreviewMsg>>) {
    const role = m?.role === "assistant" ? "assistant" : m?.role === "user" ? "user" : null;
    const content = String(m?.content ?? "").trim();
    if (!role || !content) continue;
    if (content.length > PREVIEW_LIMITS.content) return `Mỗi tin tối đa ${PREVIEW_LIMITS.content} ký tự`;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += `\n${content}`; else out.push({ role, content });
  }
  while (out.length && out[0].role !== "user") out.shift(); // bắt đầu bằng khách
  if (!out.length || out[out.length - 1].role !== "user") return "Tin cuối phải là tin của khách";
  return out;
}

export async function previewChat(db: DB, input: PreviewInput, opts: { provider?: ModelProvider | null; now?: number } = {}): Promise<PreviewOut> {
  const msgs = cleanMessages(input.messages);
  if (typeof msgs === "string") return { ok: false, error: msgs };
  const bot = previewCfg(db, input.botId, input.form);
  // luật chuyển người cứng áp cho các tin khách liền cuối (giống chatbot thật): không gọi mô hình, không tốn tiền
  const tail: Message[] = [];
  for (let i = msgs.length - 1; i >= 0 && msgs[i].role === "user"; i--) tail.unshift({ text: msgs[i].content, attachments: [] } as unknown as Message);
  const why = handoffReason(tail, { textRules: true });
  if (why) return { ok: true, kind: "handoff", reason: why };
  const provider = opts.provider === undefined ? getModelProvider() : opts.provider;
  if (!provider) return { ok: false, error: "Chưa cấu hình mô hình (thiếu ANTHROPIC_API_KEY). Nhập khóa ở Cài đặt > Khóa AI" };
  if (!takeBudget(opts.now ?? Date.now())) return { ok: false, error: `Đã dùng hết ${PREVIEW_LIMITS.perHour} lượt xem thử trong giờ này` };
  const ch = db.channels[bot.channelIds[0]] ?? ({ id: "preview", name: "Xem thử", kind: "facebook" } as unknown as Channel);
  const r = await provider.complete({ model: bot.model, system: buildSystem(db, bot, ch, "Khách thử", { now: opts.now }), messages: msgs });
  if (!r.ok) return r.kind === "refusal" ? { ok: true, kind: "handoff", reason: "Mô hình từ chối trả lời, cần người xử lý" } : { ok: false, error: r.error };
  const p = parseReply(r.text);
  if (!p) return { ok: false, error: "Mô hình trả về nội dung rỗng" };
  if (p.kind === "handoff") return { ok: true, kind: "handoff", reason: p.reason, usage: r.usage };
  return { ok: true, kind: "reply", text: p.text, ...(p.note ? { note: p.note } : {}), usage: r.usage };
}
