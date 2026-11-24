import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMetaAdapter } from "../src/adapters/meta";
import { registerAdapter } from "../src/core/adapter";
import { sendMessage } from "../src/core/send";
import { HUMAN_AGENT_WINDOW_MS, humanAgentEnabled, metaWindowState } from "../src/core/metahuman";
import { ingest } from "../src/core/ingest";
import { generateDraft } from "../src/core/chatbot";
import { setModelProvider } from "../src/core/botmodel";
import type { DB, Store } from "../src/core/store";
import type { Channel } from "../src/core/types";
import { AUTO_SEND_OFF } from "../src/core/guardrails";

const H = 3600_000;
const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);
const ch = (kind: "facebook" | "instagram" = "facebook"): Channel => ({ id: "c1", companyId: "co", kind, externalId: "PAGE1", name: "T", sendEnabled: true, ...(kind === "instagram" ? { meta: { pageId: "PAGE1" } } : {}) });

type Call = { url: string; body: Record<string, unknown> };
let calls: Call[] = [];
let reply: { status: number; json: object } = { status: 200, json: { message_id: "m1" } };
const fakeFetch = (async (url: string, init: RequestInit) => {
  calls.push({ url, body: JSON.parse(String(init.body)) });
  return new Response(JSON.stringify(reply.json), { status: reply.status });
}) as unknown as typeof fetch;

let on = false;
const mk = (kind: "facebook" | "instagram" = "facebook") =>
  createMetaAdapter({ kind, appSecret: "S", verifyToken: "V", getToken: async () => "TOK", fetchImpl: fakeFetch, humanAgent: () => on });
const reset = (enabled: boolean) => { calls = []; reply = { status: 200, json: { message_id: "m1" } }; on = enabled; };
const send = (kind: "facebook" | "instagram", ageH: number, extra: { automated?: boolean } = {}) =>
  sendMessage({ channel: ch(kind), contactExternalId: "U1", text: "dạ", lastInboundAt: NOW - ageH * H, now: NOW, ...extra });

test("cửa sổ: 24 giờ chuẩn, Human Agent 7 ngày chỉ khi bật", () => {
  assert.equal(metaWindowState(NOW - 23 * H, NOW, false), "open");
  assert.equal(metaWindowState(NOW - 25 * H, NOW, false), "closed");
  assert.equal(metaWindowState(NOW - 25 * H, NOW, true), "human_agent");
  assert.equal(metaWindowState(NOW - 7 * 24 * H, NOW, true), "human_agent");
  assert.equal(metaWindowState(NOW - 7 * 24 * H - 1, NOW, true), "closed");
  assert.equal(metaWindowState(undefined, NOW, true), "closed");
});

test("công tắc: mặc định tắt, chỉ META_HUMAN_AGENT=1 mới bật", () => {
  assert.equal(humanAgentEnabled({}), false);
  assert.equal(humanAgentEnabled({ META_HUMAN_AGENT: "0" }), false);
  assert.equal(humanAgentEnabled({ META_HUMAN_AGENT: "true" }), false);
  assert.equal(humanAgentEnabled({ META_HUMAN_AGENT: "1" }), true);
});

for (const kind of ["facebook", "instagram"] as const) {
  test(`${kind}: công tắc TẮT thì quá 24 giờ bị chặn, không gọi Meta`, async () => {
    reset(false);
    registerAdapter(mk(kind));
    const r = await send(kind, 25);
    assert.deepEqual(r, { ok: false, error: "Quá cửa sổ trả lời của kênh" });
    assert.equal(calls.length, 0);
  });

  test(`${kind}: công tắc BẬT, trong 24 giờ gửi RESPONSE, không có thẻ`, async () => {
    reset(true);
    registerAdapter(mk(kind));
    assert.equal((await send(kind, 23)).ok, true);
    assert.equal(calls[0].body.messaging_type, "RESPONSE");
    assert.equal("tag" in calls[0].body, false);
  });

  test(`${kind}: công tắc BẬT, giữa 24 giờ và 7 ngày gửi MESSAGE_TAG + HUMAN_AGENT qua Page`, async () => {
    reset(true);
    registerAdapter(mk(kind));
    assert.equal((await send(kind, 25)).ok, true);
    assert.equal((await send(kind, 6 * 24)).ok, true);
    assert.equal(calls.length, 2);
    for (const c of calls) {
      assert.equal(c.body.messaging_type, "MESSAGE_TAG");
      assert.equal(c.body.tag, "HUMAN_AGENT");
      assert.deepEqual(c.body.recipient, { id: "U1" });
      assert.match(c.url, /\/PAGE1\/messages$/);
    }
  });

  test(`${kind}: quá 7 ngày vẫn khóa dù công tắc bật`, async () => {
    reset(true);
    registerAdapter(mk(kind));
    assert.equal((await send(kind, 7 * 24 + 1)).ok, false);
    assert.equal(calls.length, 0);
  });
}

test("tin do máy (automated) không bao giờ được gửi: không Human Agent, kể cả trong 24 giờ (ràng buộc dự án)", async () => {
  reset(true);
  registerAdapter(mk("facebook"));
  const r = await send("facebook", 30, { automated: true });
  assert.deepEqual(r, { ok: false, error: AUTO_SEND_OFF });
  assert.deepEqual(await send("facebook", 2, { automated: true }), { ok: false, error: AUTO_SEND_OFF });
  assert.equal(calls.length, 0);
});

test("adapter tự kiểm lại: thẻ khi công tắc tắt, thẻ lạ, hoặc quá 7 ngày đều bị từ chối", async () => {
  reset(false);
  const a = mk();
  const base = { channel: ch(), contactExternalId: "U1", text: "x" };
  assert.deepEqual(await a.send({ ...base, messageTag: "HUMAN_AGENT", lastInboundAt: Date.now() - 30 * H }), { ok: false, error: "Human Agent đang tắt" });
  on = true;
  assert.equal((await a.send({ ...base, messageTag: "BAY" as unknown as "HUMAN_AGENT", lastInboundAt: Date.now() - 30 * H })).ok, false);
  const old = await a.send({ ...base, messageTag: "HUMAN_AGENT", lastInboundAt: Date.now() - HUMAN_AGENT_WINDOW_MS - H });
  assert.equal(old.ok, false);
  assert.equal((await a.send({ ...base, messageTag: "HUMAN_AGENT" })).ok, false, "thiếu mốc tin khách thì từ chối");
  assert.equal(calls.length, 0);
});

test("Meta từ chối thẻ: lỗi nguyên văn kèm gợi ý, không gọi lặp", async () => {
  reset(true);
  registerAdapter(mk("facebook"));
  reply = { status: 400, json: { error: { code: 10, error_subcode: 2018278, message: "This message is sent outside of allowed window." } } };
  const r = await send("facebook", 30);
  assert.equal(r.ok, false);
  assert.match(r.error!, /Meta 10\/2018278: This message is sent outside of allowed window/);
  assert.match(r.error!, /Human Agent bị từ chối/);
  assert.equal(calls.length, 1);
  // Không dùng thẻ mà Meta báo mã 10: gợi ý quá 24 giờ
  reset(true);
  reply = { status: 400, json: { error: { code: 10, message: "outside window" } } };
  assert.match((await send("facebook", 2)).error!, /quá 24 giờ/);
});

// ---- Chatbot: tuyệt đối không soạn/gửi ngoài 24 giờ, kể cả khi Human Agent đang bật ----
const mem = () => {
  const s = { db: { channels: {}, contacts: {}, conversations: {}, messages: {} } as DB, async load() { return structuredClone(s.db); }, async save(d: DB) { s.db = d; } };
  return s as Store & { db: DB };
};

test("chatbot: Human Agent bật cũng không soạn cho tin quá 24 giờ; trong 24 giờ vẫn soạn bình thường", async () => {
  reset(true);
  const a = mk("facebook");
  registerAdapter(a);
  let modelCalls = 0;
  setModelProvider({ id: "fake", async complete() { modelCalls++; return { ok: true, text: "Dạ ạ", usage: { input: 1, output: 1 } }; } });
  const s = mem();
  s.db.channels["c"] = { id: "c", companyId: "x", kind: "facebook", externalId: "P", name: "Page", sendEnabled: true };
  s.db.bot = { settings: { docs: [] }, drafts: {}, bots: { b: { id: "b", name: "Bot", type: "new", channelIds: ["c"], mode: "draft", tone: "", instructions: "", docIds: [], useTemplates: true, model: "claude-haiku-5-5", intro: "", at: 1 } } };
  const inbound = (user: string, at: number) => ingest(s, "facebook", a.parse({ object: "page", entry: [{ id: "P", messaging: [{ sender: { id: user }, recipient: { id: "P" }, timestamp: at, message: { mid: `m-${user}`, text: "chào shop" } }] }] }));
  await inbound("u1", Date.now() - 30 * H);
  assert.deepEqual(await generateDraft(s, "c:conv:u1"), { ok: false, reason: "Quá cửa sổ trả lời của kênh" });
  assert.equal(modelCalls, 0);
  await inbound("u2", Date.now() - 2 * H);
  assert.equal((await generateDraft(s, "c:conv:u2")).ok, true);
  assert.equal(modelCalls, 1);
});

test("mã nguồn chatbot không biết gì về Human Agent hay cửa sổ mở rộng", () => {
  for (const f of ["chatbot.ts", "botmodel.ts"]) {
    const src = readFileSync(new URL(`../src/core/${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /HUMAN_AGENT|metahuman|extendedWindowMs|messageTag/, f);
  }
});
