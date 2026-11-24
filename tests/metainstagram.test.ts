import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createMetaAdapter } from "../src/adapters/meta";
import { ingest } from "../src/core/ingest";
import { connectPages, createPickSession } from "../src/core/metalogin";
import { staticTokens } from "../src/core/token-store";
import type { DB, Store } from "../src/core/store";
import type { Channel } from "../src/core/types";

// Dạng payload theo tài liệu Instagram Messaging (đã đọc 22/11/2026): entry.id = id tài khoản Instagram chuyên nghiệp,
// tin khách: sender = IGSID, recipient = tài khoản; tin do tài khoản gửi: sender = tài khoản, recipient = IGSID, message.is_echo = true.
const IG = "17841400000000001", PAGE = "PAGE1", USER = "IGSID_KHACH";
const calls: Array<{ url: string; init: RequestInit }> = [];
const fakeFetch = (async (url: string, init: RequestInit) => {
  calls.push({ url, init });
  return new Response(JSON.stringify({ message_id: "m_" + calls.length, name: "Khách IG", username: "khach_ig", profile_pic: "http://x/p.jpg" }), { status: 200 });
}) as unknown as typeof fetch;
const ig = () => createMetaAdapter({ kind: "instagram", appSecret: "S", verifyToken: "V", getToken: async () => "TOK", fetchImpl: fakeFetch });
const hook = (messaging: object[], entryId = IG) => ({ object: "instagram", entry: [{ id: entryId, time: 1, messaging }] });
const channel: Channel = { id: "i1", companyId: "co", kind: "instagram", externalId: IG, name: "IG", sendEnabled: true, meta: { pageId: PAGE } };

const mem = () => {
  const s = { db: { channels: {}, contacts: {}, conversations: {}, messages: {} } as DB, async load() { return structuredClone(s.db); }, async save(d: DB) { s.db = d; } };
  return s as Store & { db: DB };
};

test("Instagram: tin khách, tin echo của tài khoản, ảnh/story", () => {
  const ev = ig().parse(hook([
    { sender: { id: USER }, recipient: { id: IG }, timestamp: 10, message: { mid: "a", text: "chào shop" } },
    { sender: { id: IG }, recipient: { id: USER }, timestamp: 11, message: { mid: "b", text: "dạ ạ", is_echo: true } },
    { sender: { id: USER }, recipient: { id: IG }, timestamp: 12, message: { mid: "c", attachments: [{ type: "image", payload: { url: "http://x/a.jpg" } }, { type: "story_mention", payload: { url: "http://x/s" } }, { type: "ig_reel", payload: { url: "http://x/r" } }] } },
  ]));
  assert.equal(ev.length, 3);
  assert.deepEqual(ev.map((e) => [e.channelExternalId, e.contact.externalId, e.message.direction]), [[IG, USER, "in"], [IG, USER, "out"], [IG, USER, "in"]]);
  assert.deepEqual(ev[2].message.attachments.map((a) => a.type), ["image", "other", "video"]);
});

test("Instagram: bỏ tin thử gửi cho chính tài khoản, lượt đã xem, biểu cảm; tin không hỗ trợ hiện dòng báo", () => {
  const ev = ig().parse(hook([
    { sender: { id: IG }, recipient: { id: IG }, message: { mid: "self", text: "test", is_self: true } },
    { sender: { id: USER }, recipient: { id: IG }, read: { mid: "x" } },
    { sender: { id: USER }, recipient: { id: IG }, reaction: { mid: "x", action: "react", reaction: "love" } },
    { sender: { id: USER }, recipient: { id: IG }, timestamp: 5, message: { mid: "u", is_unsupported: true } },
  ]));
  assert.equal(ev.length, 1);
  assert.match(ev[0].message.text, /chưa hiển thị được/);
});

test("Instagram: payload của Messenger (object page) không lọt vào adapter Instagram", () => {
  const ev = ig().parse({ object: "page", entry: [{ id: PAGE, messaging: [{ sender: { id: USER }, recipient: { id: PAGE }, message: { mid: "z", text: "a" } }] }] });
  assert.equal(ev.length, 0);
});

test("Instagram: chữ ký và xác minh webhook dùng chung App Secret và Verify Token", () => {
  const a = ig();
  const body = JSON.stringify(hook([]));
  assert.equal(a.verify(new Headers({ "x-hub-signature-256": "sha256=" + createHmac("sha256", "S").update(body).digest("hex") }), body), true);
  assert.equal(a.verify(new Headers({ "x-hub-signature-256": "sha256=00" }), body), false);
  assert.equal(a.challenge!(new URLSearchParams("hub.mode=subscribe&hub.verify_token=V&hub.challenge=77")), "77");
  assert.equal(a.challenge!(new URLSearchParams("hub.mode=subscribe&hub.verify_token=sai&hub.challenge=77")), null);
});

test("Instagram: gửi qua Page (không qua id Instagram), người nhận là IGSID, token ở header", async () => {
  calls.length = 0;
  const r = await ig().send({ channel, contactExternalId: USER, text: "dạ em chào anh" });
  assert.equal(r.ok, true);
  assert.match(calls[0].url, new RegExp(`/${PAGE}/messages$`));
  assert.doesNotMatch(calls[0].url, new RegExp(IG));
  assert.deepEqual(JSON.parse(String(calls[0].init.body)).recipient, { id: USER });
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, "Bearer TOK");
  assert.doesNotMatch(calls[0].url, /TOK/);
});

test("Instagram: lấy hồ sơ bằng IGSID, xin thêm username", async () => {
  calls.length = 0;
  const p = await ig().fetchProfile!(channel, USER);
  assert.deepEqual(p, { name: "Khách IG", avatarUrl: "http://x/p.jpg" });
  assert.match(calls[0].url, new RegExp(`/${USER}\\?fields=name,username,profile_pic`));
});

test("Instagram: webhook về đúng kênh theo id Instagram; nếu Meta gửi id Page thì khớp theo Page liên kết", async () => {
  const s = mem();
  s.db.channels["i1"] = { ...channel };
  const a = ig();
  const r1 = await ingest(s, "instagram", a.parse(hook([{ sender: { id: USER }, recipient: { id: IG }, timestamp: 1, message: { mid: "m1", text: "a" } }], IG)));
  assert.equal(r1.stored, 1);
  const r2 = await ingest(s, "instagram", a.parse(hook([{ sender: { id: USER }, recipient: { id: PAGE }, timestamp: 2, message: { mid: "m2", text: "b" } }], PAGE)));
  assert.equal(r2.stored, 1);
  assert.equal(Object.keys(s.db.conversations).length, 1, "cùng một khách, một hội thoại");
  const r3 = await ingest(s, "instagram", a.parse(hook([{ sender: { id: USER }, recipient: { id: "LA" }, timestamp: 3, message: { mid: "m3", text: "c" } }], "LA")));
  assert.equal(r3.unknownChannel, 1, "mã lạ không vào kênh nào");
  // Kênh Messenger cùng Page không nhận tin Instagram
  s.db.channels["f1"] = { id: "f1", companyId: "co", kind: "facebook", externalId: PAGE, name: "FB", sendEnabled: false };
  const r4 = await ingest(s, "instagram", a.parse(hook([{ sender: { id: "U9" }, recipient: { id: "ZZ" }, timestamp: 4, message: { mid: "m4", text: "d" } }], "ZZ")));
  assert.equal(r4.unknownChannel, 1);
});

test("Instagram: nối cùng Page thì kênh Instagram dùng chung token Page và nhớ Page liên kết", async () => {
  const s = mem();
  const sid = await createPickSession(s, [{ id: PAGE, name: "Shop", token: "TOKPAGE", tasks: ["MESSAGING"], ig: { id: IG, username: "shop_ig" } }]);
  const f = (async () => new Response(JSON.stringify({ success: true }), { status: 200 })) as unknown as typeof fetch;
  const r = await connectPages(s, sid, [{ pageId: PAGE, instagram: true }], f);
  assert.equal(r.ok, true);
  const chans = Object.values(s.db.channels);
  const fb = chans.find((c) => c.kind === "facebook")!, igc = chans.find((c) => c.kind === "instagram")!;
  assert.equal(igc.externalId, IG);
  assert.equal(igc.meta?.pageId, PAGE);
  assert.equal(igc.sendEnabled, false, "kênh mới luôn tắt gửi tin");
  assert.equal(await staticTokens(s).get(igc.id), "TOKPAGE");
  assert.equal(await staticTokens(s).get(fb.id), "TOKPAGE");
});

test("Page từng gỡ rồi nối lại: tin vào kênh đang nối, không bị kênh cũ (đã tắt) cùng mã chặn", async () => {
  const s = mem();
  const mk = (id: string, off: boolean): Channel => ({ id, companyId: "co", kind: "facebook", externalId: PAGE, name: id, sendEnabled: false, ...(off ? { off: true } : {}) });
  s.db.channels["cu"] = mk("cu", true); // kênh cũ đứng trước trong kho
  s.db.channels["moi"] = mk("moi", false);
  const fb = createMetaAdapter({ kind: "facebook", appSecret: "S", verifyToken: "V", getToken: async () => "T", fetchImpl: fakeFetch });
  const msg = { object: "page", entry: [{ id: PAGE, messaging: [{ sender: { id: "U" }, recipient: { id: PAGE }, timestamp: 1, message: { mid: "x1", text: "a" } }] }] };
  const r = await ingest(s, "facebook", fb.parse(msg));
  assert.equal(r.stored, 1);
  assert.equal(r.unknownChannel, 0);
  assert.ok(Object.values(s.db.conversations).every((c) => c.channelId === "moi"));
  // chỉ còn kênh đã tắt thì vẫn không nhận
  delete s.db.channels["moi"];
  const r2 = await ingest(s, "facebook", fb.parse({ ...msg, entry: [{ id: PAGE, messaging: [{ sender: { id: "U" }, recipient: { id: PAGE }, timestamp: 2, message: { mid: "x2", text: "b" } }] }] }));
  assert.equal(r2.unknownChannel, 1);
});
