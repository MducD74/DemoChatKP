import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createMetaAdapter } from "../src/adapters/meta";
import type { Channel } from "../src/core/types";

const channel: Channel = { id: "c1", companyId: "co", kind: "facebook", externalId: "PAGE1", name: "T", sendEnabled: true };
const calls: Array<{ url: string; init: RequestInit }> = [];
const fakeFetch = (async (url: string, init: RequestInit) => {
  calls.push({ url, init });
  return new Response(JSON.stringify({ message_id: "m_" + calls.length }), { status: 200 });
}) as unknown as typeof fetch;
const mk = (kind: "facebook" | "instagram" = "facebook", getToken = async () => "TOK") =>
  createMetaAdapter({ kind, appSecret: "S", verifyToken: "V", getToken, fetchImpl: fakeFetch });
const sign = (body: string) => "sha256=" + createHmac("sha256", "S").update(body).digest("hex");

test("xác minh GET: đúng và sai token", () => {
  const a = mk();
  assert.equal(a.challenge!(new URLSearchParams("hub.mode=subscribe&hub.verify_token=V&hub.challenge=123")), "123");
  assert.equal(a.challenge!(new URLSearchParams("hub.mode=subscribe&hub.verify_token=X&hub.challenge=123")), null);
});

test("chữ ký: thường, có unicode (dạng escape), sai", () => {
  const a = mk();
  const plain = JSON.stringify({ a: 1 });
  assert.equal(a.verify(new Headers({ "x-hub-signature-256": sign(plain) }), plain), true);
  const raw = '{"text":"xin chào"}';
  const escaped = '{"text":"xin ch\\u00e0o"}';
  assert.equal(a.verify(new Headers({ "x-hub-signature-256": sign(escaped) }), raw), true);
  assert.equal(a.verify(new Headers({ "x-hub-signature-256": sign("khac") }), plain), false);
  assert.equal(a.verify(new Headers(), plain), false);
});

const payload = (messaging: object[], object = "page") => ({ object, entry: [{ id: "PAGE1", time: 1, messaging }] });

test("parse: tin khách, echo, bỏ postback và tin xóa", () => {
  const a = mk();
  const ev = a.parse(
    payload([
      { sender: { id: "U1" }, recipient: { id: "PAGE1" }, timestamp: 10, message: { mid: "m1", text: "chào", attachments: [{ type: "image", payload: { url: "http://x/i.jpg" } }] } },
      { sender: { id: "PAGE1" }, recipient: { id: "U1" }, timestamp: 11, message: { mid: "m2", text: "dạ", is_echo: true } },
      { sender: { id: "U1" }, recipient: { id: "PAGE1" }, postback: { payload: "p" } },
      { sender: { id: "U1" }, recipient: { id: "PAGE1" }, message: { mid: "m3", is_deleted: true } },
    ])
  );
  assert.equal(ev.length, 2);
  assert.equal(ev[0].message.direction, "in");
  assert.equal(ev[0].contact.externalId, "U1");
  assert.deepEqual(ev[0].message.attachments, [{ type: "image", url: "http://x/i.jpg" }]);
  assert.equal(ev[1].message.direction, "out");
  assert.equal(ev[1].contact.externalId, "U1");
});

test("parse: object sai kênh thì bỏ; instagram dùng object instagram", () => {
  const m = [{ sender: { id: "U" }, recipient: { id: "PAGE1" }, message: { mid: "x", text: "a" } }];
  assert.equal(mk("facebook").parse(payload(m, "instagram")).length, 0);
  assert.equal(mk("instagram").parse(payload(m, "instagram")).length, 1);
});

test("gửi: chữ và ảnh thành hai tin, token ở header, không ở URL", async () => {
  calls.length = 0;
  const r = await mk().send({ channel, contactExternalId: "U1", text: "hi", attachments: [{ type: "image", url: "http://x/i.jpg" }] });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.endsWith("/PAGE1/messages"));
  assert.ok(!calls[0].url.includes("TOK"));
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, "Bearer TOK");
  assert.equal(JSON.parse(calls[0].init.body as string).messaging_type, "RESPONSE");
});

test("gửi: thiếu token, tin rỗng, tệp chưa hỗ trợ", async () => {
  assert.equal((await mk("facebook", async () => null as never).send({ channel, contactExternalId: "U1", text: "a" })).ok, false);
  assert.equal((await mk().send({ channel, contactExternalId: "U1" })).ok, false);
  assert.equal((await mk().send({ channel, contactExternalId: "U1", attachments: [{ type: "file", url: "u" }] })).ok, false);
});
