import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { DB, Store } from "../src/core/store";
import { SCRIPT_LIMITS, SEED_SCRIPTS, botScripts, deleteScript, ensureScripts, saveScript, scriptList, scriptsPrompt } from "../src/core/botscripts";
import { buildSystem, deleteBot, type BotCfg } from "../src/core/chatbot";
import { botHistory } from "../src/core/bothistory";

const mem = () => {
  const s = { db: { channels: {}, contacts: {}, conversations: {}, messages: {} } as DB,
    async load() { return structuredClone(s.db); }, async save(d: DB) { s.db = d; } };
  return s as Store & { db: DB };
};

test("lần đầu nạp kịch bản mẫu cho hai thư viện, nạp lại không nhân đôi", async () => {
  const st = mem();
  await ensureScripts(st);
  const n = scriptList(st.db).length;
  assert.equal(n, SEED_SCRIPTS.length);
  assert.ok(scriptList(st.db, "sale").length >= 10);
  assert.ok(scriptList(st.db, "care").length >= 3);
  await ensureScripts(st);
  assert.equal(scriptList(st.db).length, n);
});

test("xóa hết kịch bản thì không bị nạp lại", async () => {
  const st = mem();
  await ensureScripts(st);
  for (const s of scriptList(st.db)) assert.equal((await deleteScript(st, s.id)).ok, true);
  await ensureScripts(st);
  assert.equal(scriptList(st.db).length, 0);
});

test("tạo, sửa kịch bản và kiểm tra dữ liệu vào", async () => {
  const st = mem();
  await ensureScripts(st);
  const made = await saveScript(st, { lib: "care", title: "Chúc mừng sinh nhật", when: "Ngày sinh của khách", body: "B: Chúc mừng sinh nhật [Tên]!" });
  assert.ok(made.ok);
  if (!made.ok) return;
  assert.equal(scriptList(st.db, "care").some((s) => s.id === made.script.id), true);
  // sửa: không đổi được thư viện
  const edit = await saveScript(st, { id: made.script.id, lib: "sale", title: "Chúc mừng sinh nhật", when: "", body: "B: Chúc mừng!" });
  assert.ok(edit.ok);
  assert.equal(scriptList(st.db).find((s) => s.id === made.script.id)?.lib, "care");
  // dữ liệu sai
  assert.equal((await saveScript(st, { lib: "xx", title: "a", body: "b" })).ok, false);
  assert.equal((await saveScript(st, { lib: "sale", title: "", body: "b" })).ok, false);
  assert.equal((await saveScript(st, { lib: "sale", title: "a", body: "" })).ok, false);
  assert.equal((await saveScript(st, { lib: "sale", title: "a", body: "x".repeat(SCRIPT_LIMITS.body + 1) })).ok, false);
  assert.equal((await saveScript(st, { id: "không-có", lib: "sale", title: "a", body: "b" })).ok, false);
  // trùng tên trong cùng thư viện
  const dup = await saveScript(st, { lib: "sale", title: SEED_SCRIPTS.find((s) => s.lib === "sale")!.title.toUpperCase(), body: "b" });
  assert.equal(dup.ok, false);
});

test("không nạp kịch bản mẫu khi quản trị đã có thư viện riêng", async () => {
  const st = mem();
  await saveScript(st, { lib: "sale", title: "Riêng", body: "B: x" }); // tạo trước, chưa có mẫu
  const before = scriptList(st.db).length;
  assert.equal(before, 1);
  await ensureScripts(st);
  assert.equal(scriptList(st.db).length, 1);
});

test("botscripts.ts không có đường gửi tin", () => {
  const src = readFileSync(new URL("../src/core/botscripts.ts", import.meta.url), "utf8");
  assert.ok(!/from "\.\/(send|service)"/.test(src));
  assert.ok(!/sendMessage|sendReply/.test(src.replace(/\/\/.*$/gm, "")));
});

test("kịch bản mẫu có mã không trùng và nội dung hợp giới hạn", () => {
  const keys = new Set(SEED_SCRIPTS.map((s) => s.key));
  assert.equal(keys.size, SEED_SCRIPTS.length);
  for (const s of SEED_SCRIPTS) {
    assert.ok(s.title.length <= SCRIPT_LIMITS.title, s.key);
    assert.ok(s.when.length <= SCRIPT_LIMITS.when, s.key);
    assert.ok(s.body.length > 0 && s.body.length <= SCRIPT_LIMITS.body, s.key);
  }
});

// ---------- Kịch bản riêng theo chatbot ----------
const botCfg = (id: string): BotCfg => ({ id, name: `Chatbot ${id}`, type: "new", channelIds: [], mode: "draft", tone: "", instructions: "", docIds: [], useTemplates: false, model: "m", intro: "", at: 0 } as BotCfg);
const withBots = async () => { const st = mem(); await ensureScripts(st); st.db.bot!.bots = { a: botCfg("a"), b: botCfg("b") }; return st; };

test("kịch bản riêng: sao từ kho mẫu ra cho một chatbot, kho mẫu không đổi, bản riêng sửa độc lập", async () => {
  const st = await withBots();
  const src = scriptList(st.db, "sale")[0];
  const r = await saveScript(st, { lib: src.lib, title: src.title, when: src.when, body: src.body, botId: "a", from: src.id });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.script.botId, "a"); assert.equal(r.script.from, src.id);
  assert.equal(scriptList(st.db).length, SEED_SCRIPTS.length, "kho mẫu không thêm");
  assert.deepEqual(botScripts(st.db, "a").map((s) => s.id), [r.script.id]);
  assert.equal(botScripts(st.db, "b").length, 0);
  // sửa bản riêng: không đổi chatbot, không đổi kho mẫu
  const e = await saveScript(st, { id: r.script.id, lib: "care", title: src.title, when: "", body: "K: x\nB: y", botId: "b" });
  assert.ok(e.ok);
  assert.equal(botScripts(st.db, "a")[0].body, "K: x\nB: y");
  assert.equal(botScripts(st.db, "a")[0].lib, src.lib, "không đổi thư viện");
  assert.equal(botScripts(st.db, "b").length, 0, "không chuyển sang chatbot khác");
  assert.equal(scriptList(st.db).find((s) => s.id === src.id)!.body, src.body);
});

test("kịch bản riêng: trùng tên chỉ tính trong cùng chatbot; chatbot lạ bị từ chối; có giới hạn số lượng", async () => {
  const st = await withBots();
  const mk = (botId: string, title: string) => saveScript(st, { lib: "sale", title, when: "", body: "B: ok", botId });
  assert.ok((await mk("a", "Chào")).ok);
  assert.equal((await mk("a", "chào")).ok, false);
  assert.ok((await mk("b", "Chào")).ok, "chatbot khác được trùng tên");
  assert.equal((await mk("zzz", "X")).ok, false);
  for (let i = 0; i < SCRIPT_LIMITS.perBot - 1; i++) assert.ok((await mk("a", `K${i}`)).ok);
  const over = await mk("a", "Thừa");
  assert.equal(over.ok, false);
});

test("kịch bản riêng đi vào lời nhắc của đúng chatbot; chatbot không có kịch bản thì lời nhắc không có mục này", async () => {
  const st = await withBots();
  st.db.channels["c"] = { id: "c", kind: "web", name: "Web" } as never;
  await saveScript(st, { lib: "sale", title: "Khách chê đắt", when: "Khách chê giá", body: "K: đắt quá\nB: Dạ [món] làm từ [nguyên liệu] ạ", botId: "a" });
  const sysA = buildSystem(st.db, st.db.bot!.bots!["a"], st.db.channels["c"], "Khách");
  const sysB = buildSystem(st.db, st.db.bot!.bots!["b"], st.db.channels["c"], "Khách");
  assert.match(sysA, /KỊCH BẢN TƯ VẤN CỦA CHATBOT NÀY[^\n]*\n### Khách chê đắt \(khi: Khách chê giá\)\nK: đắt quá/);
  assert.doesNotMatch(sysB, /KỊCH BẢN TƯ VẤN/);
  assert.doesNotMatch(sysA, /Khách mới chào hỏi/, "kho mẫu không tự vào lời nhắc");
  assert.equal(scriptsPrompt([]), "");
});

test("lời nhắc kịch bản bị cắt theo giới hạn chữ", () => {
  const big = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, lib: "sale" as const, title: `T${i}`, when: "", body: "x".repeat(3000), at: 0, botId: "a" }));
  const p = scriptsPrompt(big);
  assert.ok(p.length < SCRIPT_LIMITS.prompt + 500);
  assert.match(p, /### T1/); assert.doesNotMatch(p, /### T5/);
});

test("xóa chatbot thì xóa kịch bản riêng của nó, không đụng kho mẫu và chatbot khác", async () => {
  const st = await withBots();
  await saveScript(st, { lib: "sale", title: "A1", when: "", body: "B: a", botId: "a" });
  await saveScript(st, { lib: "sale", title: "B1", when: "", body: "B: b", botId: "b" });
  assert.equal((await deleteBot(st, "a")).ok, true);
  assert.equal(botScripts(st.db, "a").length, 0);
  assert.equal(botScripts(st.db, "b").length, 1);
  assert.equal(scriptList(st.db).length, SEED_SCRIPTS.length);
});

test("lịch sử chatbot: chỉ nháp của chatbot đó, mới nhất trước, có tên khách và kênh, cắt gọn, có giới hạn số dòng", async () => {
  const st = await withBots();
  const db = st.db;
  db.channels["c"] = { id: "c", kind: "web", name: "Web shop" } as never;
  db.contacts["k"] = { id: "k", name: "Lan" } as never;
  db.conversations["v"] = { id: "v", contactId: "k", channelId: "c" } as never;
  const mk = (id: string, botId: string, at: number, over: object = {}) => ({ id, botId, conversationId: "v", channelId: "c", forInboundAt: at, kind: "reply", text: "x".repeat(500), status: "used", shadow: false, at, ...over });
  db.bot!.drafts = { d1: mk("d1", "a", 100), d2: mk("d2", "a", 300, { status: "discarded" }), d3: mk("d3", "b", 200), d4: mk("d4", "a", 200, { kind: "handoff", reason: "Khách đòi gặp người" }) } as never;
  const rows = botHistory(db, "a");
  assert.deepEqual(rows.map((r) => r.id), ["d2", "d4", "d1"]);
  assert.equal(rows[0].contact, "Lan"); assert.equal(rows[0].channel, "Web shop");
  assert.ok(rows[0].text.length <= 220);
  assert.equal(rows[1].reason, "Khách đòi gặp người");
  assert.equal(botHistory(db, "a", 2).length, 2);
  assert.equal(botHistory(db, "khong-co").length, 0);
});
