import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { DB } from "../src/core/store";
import type { ModelProvider, ModelRequest } from "../src/core/botmodel";
import { PREVIEW_LIMITS, cleanMessages, previewChat, previewCfg, resetPreviewBudget } from "../src/core/botpreview";
import { ensureScripts, saveScript } from "../src/core/botscripts";
import type { BotCfg } from "../src/core/chatbot";

const mkDb = (): DB => ({
  channels: { c: { id: "c", kind: "web", name: "Web shop" } },
  contacts: {}, conversations: {}, messages: {},
  bot: {
    settings: { docs: [{ id: "d1", title: "Bảng giá", body: "Giỏ quà 299k", at: 1 }, { id: "d2", title: "Chính sách ship", body: "Ship theo app", at: 1 }] },
    bots: { b1: { id: "b1", name: "Xuxi", type: "new", channelIds: ["c"], mode: "off", tone: "Lịch sự, trang trọng", instructions: "Đã lưu", docIds: ["d1"], useTemplates: false, model: "claude-haiku-5-5", intro: "", at: 5 } as BotCfg },
    drafts: {},
  },
} as unknown as DB);
const fake = (text: string, calls: ModelRequest[] = []): ModelProvider => ({ id: "fake", async complete(req) { calls.push(req); return { ok: true, text, usage: { input: 10, output: 5 } }; } });

test("xem thử dùng cấu hình ĐANG SỬA, không phải bản đã lưu, và không ghi gì vào dữ liệu", async () => {
  resetPreviewBudget();
  const db = mkDb(); const before = JSON.stringify(db); const calls: ModelRequest[] = [];
  const r = await previewChat(db, { botId: "b1", form: { name: "Xuxi", type: "new", mode: "draft", tone: "Nhiệt tình, vui vẻ", instructions: "Quy tắc đang sửa", docIds: ["d2"], useTemplates: false, model: "claude-sonnet-5-5" }, messages: [{ role: "user", content: "Giao hàng sao?" }] }, { provider: fake("Dạ ship theo app ạ.\nGHI_CHU: khách hỏi ship", calls) });
  assert.deepEqual(r, { ok: true, kind: "reply", text: "Dạ ship theo app ạ.", note: "khách hỏi ship", usage: { input: 10, output: 5 } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "claude-sonnet-5-5");
  assert.match(calls[0].system, /GIỌNG ĐIỆU: Nhiệt tình, vui vẻ/);
  assert.match(calls[0].system, /Quy tắc đang sửa/); assert.doesNotMatch(calls[0].system, /Đã lưu/);
  assert.match(calls[0].system, /### Chính sách ship/); assert.doesNotMatch(calls[0].system, /### Bảng giá/);
  assert.match(calls[0].system, /HÔM NAY:/);
  assert.deepEqual(calls[0].messages, [{ role: "user", content: "Giao hàng sao?" }]);
  assert.equal(JSON.stringify(db), before, "không đổi dữ liệu");
});

test("xem thử: luật chuyển người cứng không gọi mô hình; mô hình trả CHUYEN_NGUOI thì báo chuyển người", async () => {
  resetPreviewBudget();
  const calls: ModelRequest[] = [];
  const hard = await previewChat(mkDb(), { form: {}, messages: [{ role: "user", content: "Cho tôi gặp nhân viên thật, tôi muốn hoàn tiền." }] }, { provider: fake("x", calls) });
  assert.equal(hard.ok && hard.kind, "handoff"); assert.equal(calls.length, 0);
  const soft = await previewChat(mkDb(), { form: {}, messages: [{ role: "user", content: "Giảm cho em 30% nhé" }] }, { provider: fake("Dạ em nhờ nhân viên.\nCHUYEN_NGUOI: khách đòi giảm giá") });
  assert.deepEqual(soft.ok && soft.kind === "handoff" ? soft.reason : null, "khách đòi giảm giá");
});

test("xem thử: kịch bản riêng của chatbot đã lưu vào lời nhắc; chatbot chưa lưu thì không có", async () => {
  resetPreviewBudget();
  const st = { db: mkDb(), async load() { return structuredClone(this.db); }, async save(d: DB) { this.db = d; } };
  await ensureScripts(st as never);
  await saveScript(st as never, { lib: "sale", title: "Chê đắt", when: "Khách chê giá", body: "K: đắt\nB: Dạ ạ", botId: "b1" });
  const calls: ModelRequest[] = [];
  await previewChat(st.db, { botId: "b1", form: {}, messages: [{ role: "user", content: "Món này có gì" }] }, { provider: fake("ok", calls) });
  await previewChat(st.db, { form: {}, messages: [{ role: "user", content: "Món này có gì" }] }, { provider: fake("ok", calls) });
  assert.match(calls[0].system, /KỊCH BẢN TƯ VẤN CỦA CHATBOT NÀY/); assert.match(calls[0].system, /### Chê đắt/);
  assert.doesNotMatch(calls[1].system, /KỊCH BẢN TƯ VẤN/);
});

test("xem thử: kiểm tra tin nhắn thử (giới hạn lượt, độ dài, gộp lượt cùng vai, phải kết thúc bằng khách)", () => {
  assert.equal(typeof cleanMessages([]), "string");
  assert.equal(typeof cleanMessages([{ role: "assistant", content: "Chào" }]), "string");
  assert.match(String(cleanMessages([{ role: "user", content: "x".repeat(PREVIEW_LIMITS.content + 1) }])), /tối đa/);
  assert.match(String(cleanMessages(Array.from({ length: PREVIEW_LIMITS.turns + 1 }, () => ({ role: "user", content: "a" })))), /tối đa/);
  assert.deepEqual(cleanMessages([{ role: "assistant", content: "Chào" }, { role: "user", content: "a" }, { role: "user", content: "b" }, { role: "assistant", content: "c" }, { role: "user", content: "d" }]),
    [{ role: "user", content: "a\nb" }, { role: "assistant", content: "c" }, { role: "user", content: "d" }]);
  assert.equal(typeof cleanMessages([{ role: "user", content: "a" }, { role: "assistant", content: "b" }]), "string");
});

test("xem thử: chưa có khóa mô hình thì báo; hết hạn mức giờ thì báo; giá trị lạ trong form dùng mặc định", async () => {
  resetPreviewBudget();
  const m = [{ role: "user" as const, content: "Chào" }];
  const none = await previewChat(mkDb(), { form: {}, messages: m }, { provider: null });
  assert.equal(none.ok, false);
  for (let i = 0; i < PREVIEW_LIMITS.perHour; i++) assert.equal((await previewChat(mkDb(), { form: {}, messages: m }, { provider: fake("ok"), now: 1000 })).ok, true);
  const over = await previewChat(mkDb(), { form: {}, messages: m }, { provider: fake("ok"), now: 2000 });
  assert.equal(over.ok, false); assert.match(over.ok ? "" : over.error, /hết 60 lượt/);
  assert.equal((await previewChat(mkDb(), { form: {}, messages: m }, { provider: fake("ok"), now: 1000 + 3_700_000 })).ok, true, "sang giờ mới thì dùng lại được");
  const cfg = previewCfg(mkDb(), "khong-co", { model: "gpt-x", type: "lạ", docIds: ["d1", "zzz"], channelIds: ["c", "zzz"], mode: "auto" });
  assert.equal(cfg.model, "claude-haiku-5-5"); assert.equal(cfg.type, "new"); assert.deepEqual(cfg.docIds, ["d1"]); assert.deepEqual(cfg.channelIds, ["c"]); assert.equal(cfg.id, "preview");
});

test("botpreview.ts không có đường gửi tin", () => {
  const src = readFileSync(new URL("../src/core/botpreview.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /^import (?!type)[^\n]*from "\.\/(send|service|ingest|store)"/m);
  assert.doesNotMatch(src.replace(/^\/\/.*$/gm, ""), /sendMessage|sendReply|mutate\(/);
});

test("xem thử dùng hồ sơ thương hiệu và bộ lọc tài liệu của thương hiệu đang chọn", async () => {
  resetPreviewBudget();
  const db = mkDb();
  db.bot!.brands = [{ id: "br1", name: "Xuxi", channelIds: ["c"], at: 1, profile: { delivery: "Giao nội thành, ship theo app." } }, { id: "br2", name: "Labanfood", channelIds: [], at: 1 }];
  db.bot!.settings.docs[0].brandId = "br2";
  db.bot!.settings.docs[1].brandId = "br1";
  const calls: ModelRequest[] = [];
  await previewChat(db, { form: { brandId: "br1", docIds: ["d1", "d2"] }, messages: [{ role: "user", content: "Giao hàng sao?" }] }, { provider: fake("ok", calls) });
  assert.match(calls[0].system, /THÔNG TIN CHÍNH THỨC CỦA XUXI[\s\S]*Giao nội thành, ship theo app\./);
  assert.match(calls[0].system, /### Chính sách ship/); assert.doesNotMatch(calls[0].system, /### Bảng giá/, "tài liệu thương hiệu khác bị lọc");
});
