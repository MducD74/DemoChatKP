// Ràng buộc bắt buộc của dự án: chatbot không tự gửi cho khách; không nối Zalo cá nhân bằng zca-js.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { DB, Store } from "../src/core/store";
import { normalizeDb } from "../src/core/store";
import { getAdapter, registerAdapter } from "../src/core/adapter";
import { mockAdapter, sent } from "../src/adapters/mock";
import { ingest } from "../src/core/ingest";
import { setModelProvider, type ModelProvider } from "../src/core/botmodel";
import { DEFAULT_INTRO, saveBot } from "../src/core/chatbot";
import { runBot } from "../src/core/botauto";
import { sendMessage } from "../src/core/send";
import { AUTO_SEND_OFF, BOT_AUTO_SEND, ZALO_PERSONAL_ENABLED, ZALO_PERSONAL_OFF } from "../src/core/guardrails";
import { defaultDeps } from "../src/core/zalopersonal";
import { initAdapters } from "../src/adapters";

registerAdapter(mockAdapter);
const mem = () => {
  const s = { db: { channels: {}, contacts: {}, conversations: {}, messages: {} } as DB,
    async load() { return structuredClone(s.db); }, async save(d: DB) { s.db = d; } };
  return s as Store & { db: DB };
};
const fake: ModelProvider = { id: "fake", async complete() { return { ok: true, text: "Dạ hộp trái cây 200g giá 45.000đ ạ.", usage: { input: 1, output: 1 } }; } };

test("hằng số ràng buộc đang tắt và không đọc từ biến môi trường", () => {
  assert.equal(BOT_AUTO_SEND, false);
  assert.equal(ZALO_PERSONAL_ENABLED, false);
  const src = readFileSync(new URL("../src/core/guardrails.ts", import.meta.url), "utf8");
  assert.ok(!/process\.env/.test(src), "không được có công tắc môi trường để bật lại");
});

test("không tạo được chatbot ở chế độ Tự trả lời", async () => {
  const s = mem();
  s.db.channels.c = { id: "c", companyId: "x", kind: "facebook", externalId: "P", name: "Page thử", sendEnabled: true };
  const r = await saveBot(s, { name: "Xuxi", type: "new", mode: "auto", channelIds: ["c"] });
  assert.deepEqual(r, { ok: false, error: AUTO_SEND_OFF });
  assert.equal((await saveBot(s, { name: "Xuxi", type: "new", mode: "draft", channelIds: ["c"] })).ok, true);
});

test("dữ liệu cũ có chatbot Tự trả lời được đổi thành Soạn nháp khi nạp kho", () => {
  const db = { channels: {}, contacts: {}, conversations: {}, messages: {}, bot: { settings: { docs: [] }, drafts: {}, bots: {
    a: { id: "a", name: "A", type: "new", channelIds: [], mode: "auto", tone: "", instructions: "", docIds: [], useTemplates: true, model: "claude-haiku-5-5", intro: DEFAULT_INTRO, at: 1 },
    b: { id: "b", name: "B", type: "new", channelIds: [], mode: "shadow", tone: "", instructions: "", docIds: [], useTemplates: true, model: "claude-haiku-5-5", intro: DEFAULT_INTRO, at: 1 },
  } } } as unknown as DB;
  normalizeDb(db);
  assert.equal(db.bot!.bots!.a.mode, "draft");
  assert.equal(db.bot!.bots!.b.mode, "shadow");
});

test("chatbot bị ghi nhầm chế độ auto trong kho vẫn chỉ soạn nháp, không gửi gì cho khách", async () => {
  sent.length = 0;
  setModelProvider(fake);
  const s = mem();
  s.db.channels.c = { id: "c", companyId: "x", kind: "facebook", externalId: "P", name: "Page thử", sendEnabled: true };
  s.db.bot = { settings: { docs: [] }, drafts: {}, bots: { b: { id: "b", name: "Xuxi", type: "new", channelIds: ["c"], mode: "auto", tone: "", instructions: "", docIds: [], useTemplates: true, model: "claude-haiku-5-5", intro: DEFAULT_INTRO, at: 1 } } } as unknown as DB["bot"];
  await ingest(s, "facebook", mockAdapter.parse({ page: "P", user: "u1", mid: "m1", text: "Hộp trái cây giá bao nhiêu?", ts: Date.now() - 1000 }));
  const r = await runBot(s, "c:conv:u1");
  assert.equal(r.ok, true);
  assert.equal(sent.length, 0, "không có tin nào gửi cho khách");
  const drafts = Object.values(s.db.bot!.drafts);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].status, "pending", "nháp chờ nhân viên duyệt");
  assert.ok(!Object.values(s.db.messages).some((m) => m.bot), "không có tin nào mang dấu bot");
});

test("lõi gửi tin từ chối mọi tin do máy gửi", async () => {
  sent.length = 0;
  const ch = { id: "c", companyId: "x", kind: "facebook" as const, externalId: "P", name: "Page", sendEnabled: true };
  const r = await sendMessage({ channel: ch, contactExternalId: "u1", text: "x", lastInboundAt: Date.now(), automated: true });
  assert.deepEqual(r, { ok: false, error: AUTO_SEND_OFF });
  assert.equal(sent.length, 0);
});

test("Zalo cá nhân: không nạp zca-js, không đăng ký adapter", async () => {
  await assert.rejects(defaultDeps.create(), (e: Error) => e.message === ZALO_PERSONAL_OFF);
  initAdapters(mem());
  assert.equal(getAdapter("zalo_personal"), undefined);
  for (const f of ["../src/app/api/connect/zalo-personal/route.ts", "../src/app/api/connect/zalo-personal/groups/route.ts"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    const handlers = src.split(/export async function /).slice(1);
    assert.ok(handlers.length > 0);
    for (const h of handlers) assert.match(h, /if \(!ZALO_PERSONAL_ENABLED\) return/, "mọi API Zalo cá nhân phải từ chối");
  }
});
