import test from "node:test";
import assert from "node:assert/strict";
import { createMetaAdapter } from "../src/adapters/meta";
import { registerAdapter } from "../src/core/adapter";
import { ingest } from "../src/core/ingest";
import { enrichProfiles } from "../src/core/profile";
import type { DB, Store } from "../src/core/store";
import type { Channel } from "../src/core/types";

const channel: Channel = { id: "c1", companyId: "co", kind: "facebook", externalId: "PAGE1", name: "T", sendEnabled: false };
const memStore = (): Store & { db: DB } => {
  const s = { db: { channels: { c1: channel }, contacts: {}, conversations: {}, messages: {} } as DB,
    async load() { return structuredClone(s.db); }, async save(d: DB) { s.db = d; } };
  return s;
};

const urls: string[] = [];
let reply: { status: number; body: unknown } = { status: 200, body: { name: "Nguyễn Văn A", profile_pic: "https://cdn/x.jpg" } };
const fakeFetch = (async (url: string) => {
  urls.push(url);
  return new Response(JSON.stringify(reply.body), { status: reply.status });
}) as unknown as typeof fetch;
const mk = (kind: "facebook" | "instagram" = "facebook", getToken: () => Promise<string | null> = async () => "TOK") =>
  createMetaAdapter({ kind, appSecret: "S", verifyToken: "V", getToken, fetchImpl: fakeFetch });

const webhook = (mid: string, user = "U1") => ({
  object: "page",
  entry: [{ id: "PAGE1", messaging: [{ sender: { id: user }, recipient: { id: "PAGE1" }, timestamp: 1000, message: { mid, text: "hi" } }] }],
});

test("fetchProfile: lấy tên và ảnh Messenger", async () => {
  urls.length = 0;
  reply = { status: 200, body: { name: "Nguyễn Văn A", profile_pic: "https://cdn/x.jpg" } };
  const p = await mk().fetchProfile!(channel, "U1");
  assert.deepEqual(p, { name: "Nguyễn Văn A", avatarUrl: "https://cdn/x.jpg" });
  assert.match(urls[0], /\/U1\?fields=name,profile_pic$/);
});

test("fetchProfile: Instagram dùng username khi không có tên", async () => {
  urls.length = 0;
  reply = { status: 200, body: { username: "lan.studio", profile_pic: "https://cdn/i.jpg" } };
  const p = await mk("instagram").fetchProfile!(channel, "IG1");
  assert.equal(p?.name, "lan.studio");
  assert.match(urls[0], /fields=name,username,profile_pic/);
});

test("fetchProfile: lỗi Meta, không token hoặc không có dữ liệu thì trả null", async () => {
  reply = { status: 400, body: { error: { message: "x" } } };
  assert.equal(await mk().fetchProfile!(channel, "U1"), null);
  reply = { status: 200, body: {} };
  assert.equal(await mk().fetchProfile!(channel, "U1"), null);
  assert.equal(await mk("facebook", async () => null).fetchProfile!(channel, "U1"), null);
});

test("ingest báo khách chưa có tên cần lấy hồ sơ, và không báo trùng", async () => {
  const s = memStore();
  const a = mk();
  const r = await ingest(s, "facebook", a.parse(webhook("m1")));
  assert.deepEqual(r.needProfile, [{ contactId: "c1:U1", channelId: "c1", externalId: "U1" }]);
  const two = await ingest(s, "facebook", [...a.parse(webhook("m2")), ...a.parse(webhook("m3"))]);
  assert.equal(two.needProfile.length, 1);
});

test("enrichProfiles ghi tên và ảnh, sau đó không báo cần lấy nữa", async () => {
  registerAdapter(mk());
  reply = { status: 200, body: { name: "Nguyễn Văn A", profile_pic: "https://cdn/x.jpg" } };
  const s = memStore();
  const r = await ingest(s, "facebook", mk().parse(webhook("m1")));
  assert.equal(await enrichProfiles(s, "facebook", r.needProfile), 1);
  assert.equal(s.db.contacts["c1:U1"].name, "Nguyễn Văn A");
  assert.equal(s.db.contacts["c1:U1"].avatarUrl, "https://cdn/x.jpg");
  const again = await ingest(s, "facebook", mk().parse(webhook("m4")));
  assert.equal(again.needProfile.length, 0);
});

test("lấy hồ sơ lỗi: giữ nguyên tên, không thử lại trong 1 giờ", async () => {
  registerAdapter(mk());
  reply = { status: 400, body: { error: { message: "no" } } };
  const s = memStore();
  const r = await ingest(s, "facebook", mk().parse(webhook("m1")));
  assert.equal(await enrichProfiles(s, "facebook", r.needProfile), 0);
  assert.equal(s.db.contacts["c1:U1"].name, "U1");
  assert.ok(s.db.contacts["c1:U1"].profileAt);
  const again = await ingest(s, "facebook", mk().parse(webhook("m5")));
  assert.equal(again.needProfile.length, 0);
});

test("khách đã có tên từ kênh thì không cần lấy hồ sơ", async () => {
  const s = memStore();
  const ev = mk().parse(webhook("m1"));
  ev[0].contact.name = "Có Tên";
  assert.equal((await ingest(s, "facebook", ev)).needProfile.length, 0);
});
