import test from "node:test";
import assert from "node:assert/strict";
import { ingest } from "../src/core/ingest";
import { registerAdapter } from "../src/core/adapter";
import { sendMessage } from "../src/core/send";
import { mockAdapter, sent } from "../src/adapters/mock";
import type { DB, Store } from "../src/core/store";
import type { Channel } from "../src/core/types";

const channel: Channel = {
  id: "c1", companyId: "co", kind: "facebook", externalId: "PAGE1", name: "Test", sendEnabled: false,
};
const memStore = (): Store & { db: DB } => {
  const s = { db: { channels: { c1: channel }, contacts: {}, conversations: {}, messages: {} } as DB,
    async load() { return structuredClone(s.db); }, async save(d: DB) { s.db = d; } };
  return s;
};
registerAdapter(mockAdapter);
const ev = (mid: string, at = 1000) => mockAdapter.parse({ page: "PAGE1", user: "U1", mid, text: "hi", ts: at });

test("ingest lưu tin và chống trùng", async () => {
  const s = memStore();
  assert.equal((await ingest(s, "facebook", ev("m1"))).stored, 1);
  const r = await ingest(s, "facebook", ev("m1"));
  assert.equal(r.duplicates, 1);
  assert.equal(Object.keys(s.db.messages).length, 1);
  assert.equal(s.db.conversations["c1:conv:U1"].lastInboundAt, 1000);
});

test("kênh lạ bị bỏ", async () => {
  const s = memStore();
  const e = mockAdapter.parse({ page: "NOPE", user: "U", mid: "x" });
  assert.equal((await ingest(s, "facebook", e)).unknownChannel, 1);
});

test("verify webhook theo secret", () => {
  assert.equal(mockAdapter.verify(new Headers({ "x-mock-secret": "dev" }), ""), true);
  assert.equal(mockAdapter.verify(new Headers(), ""), false);
});

test("gửi tin: mặc định tắt, đúng cửa sổ, quá hạn", async () => {
  const base = { channel, contactExternalId: "U1", text: "ok", lastInboundAt: 1000, now: 2000 };
  assert.equal((await sendMessage(base)).ok, false);
  const on = { ...channel, sendEnabled: true };
  assert.equal((await sendMessage({ ...base, channel: on })).ok, true);
  assert.equal(sent.length, 1);
  assert.equal((await sendMessage({ ...base, channel: on, now: 1000 + 25 * 3600 * 1000 })).ok, false);
  assert.equal((await sendMessage({ ...base, channel: on, lastInboundAt: undefined })).ok, false);
});
