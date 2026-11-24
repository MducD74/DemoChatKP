import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createTikTokAdapter, parseTikTokMediaRef } from "../src/adapters/tiktok";
import { registerAdapter } from "../src/core/adapter";
import { sendMessage } from "../src/core/send";
import { ingest } from "../src/core/ingest";
import type { ChannelTokens, TokenStore } from "../src/core/token-store";
import type { DB, Store } from "../src/core/store";
import type { Channel } from "../src/core/types";

const NOW = 1_700_000_000_000;
const channel: Channel = { id: "t1", companyId: "co", kind: "tiktok", externalId: "BIZ1", name: "TikTok", sendEnabled: true };

const fresh = (over: Partial<ChannelTokens> = {}): ChannelTokens => ({
  accessToken: "AT1", refreshToken: "RT1", accessExpiresAt: NOW + 3600_000, refreshExpiresAt: NOW + 300 * 86400_000, ...over,
});
function memTokens(t: ChannelTokens | null) {
  const s = { cur: t, saves: 0, async get() { return s.cur; }, async save(_: string, n: ChannelTokens) { s.cur = n; s.saves++; } };
  return s as TokenStore & { cur: ChannelTokens | null; saves: number };
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
function router(routes: Record<string, Handler[]>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.includes(k));
    const h = key && routes[key].shift();
    return h ? h(url, init) : new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const json = (o: unknown) => () => new Response(JSON.stringify(o), { status: 200 });
const sentOk = (id = "m1") => json({ code: 0, message: "OK", data: { message: { message_id: id } } });
const mk = (tokens: TokenStore, f: typeof fetch) =>
  createTikTokAdapter({ clientKey: "KEY", clientSecret: "SEC", tokens, fetchImpl: f, now: () => NOW });

const content = (over: object = {}) => JSON.stringify({
  from: "khach_a", to: "shop", from_user: { id: "UID1", role: "personal_account" }, to_user: { id: "BIZ1", role: "business_account" },
  conversation_id: "CONV1", message_id: "MSG1", timestamp: 1700000000123, type: "text", text: { body: "giá sao shop" }, ...over,
});
const event = (c: string, over: object = {}) => ({ client_key: "KEY", event: "im_receive_msg", create_time: 1700000000, user_openid: "BIZ1", content: c, ...over });

test("chữ ký: t.body bằng HMAC-SHA256, chống phát lại, sai chữ ký", () => {
  const a = mk(memTokens(null), router({}).f);
  const raw = JSON.stringify(event(content()));
  const t = String(NOW / 1000);
  const s = createHmac("sha256", "SEC").update(`${t}.${raw}`).digest("hex");
  const h = (sig: string, ts = t) => new Headers({ "tiktok-signature": `t=${ts},s=${sig}` });
  assert.equal(a.verify(h(s), raw), true);
  assert.equal(a.verify(h(s.replace(/.$/, "0")), raw), false);
  assert.equal(a.verify(h(s), raw.replace("giá sao shop", "giá khác")), false); // nội dung bị sửa
  assert.equal(a.verify(h(s), JSON.stringify(JSON.parse(raw), null, 2)), true); // chỉ khác khoảng trắng: vẫn đúng chữ ký của JSON gốc
  // timestamp cũ hơn 5 phút: từ chối dù chữ ký đúng
  const old = String(NOW / 1000 - 600);
  const sOld = createHmac("sha256", "SEC").update(`${old}.${raw}`).digest("hex");
  assert.equal(a.verify(h(sOld, old), raw), false);
  assert.equal(a.verify(new Headers(), raw), false);
});

test("parse: tin khách đến (text, ảnh, bài đăng); echo đi; bỏ sự kiện khác", () => {
  const a = mk(memTokens(null), router({}).f);
  const t = a.parse(event(content()));
  assert.equal(t.length, 1);
  assert.equal(t[0].channelExternalId, "BIZ1");
  assert.equal(t[0].conversationExternalId, "CONV1");
  assert.equal(t[0].contact.externalId, "UID1");
  assert.equal(t[0].contact.name, "khach_a");
  assert.equal(t[0].message.direction, "in");
  assert.equal(t[0].message.text, "giá sao shop");
  assert.equal(t[0].message.at, 1700000000123);

  const img = a.parse(event(content({ message_id: "M2", type: "image", text: undefined, image: { media_id: "MEDIA1" } })));
  assert.equal(img[0].message.attachments[0].type, "image");
  assert.deepEqual(parseTikTokMediaRef(img[0].message.attachments[0].url), { conversationId: "CONV1", messageId: "M2", mediaId: "MEDIA1" });

  const post = a.parse(event(content({ message_id: "M3", type: "share_post", text: undefined, share_post: { embed_url: "https://tiktok.com/x" } })));
  assert.match(post[0].message.text, /tiktok\.com\/x/);

  const out = a.parse(event(content({ from_user: { id: "BIZ1", role: "business_account" }, to_user: { id: "UID1", role: "personal_account" }, message_id: "M4" }), { event: "im_send_msg" }));
  assert.equal(out[0].message.direction, "out");
  assert.equal(out[0].contact.externalId, "UID1");

  assert.equal(a.parse(event(content(), { event: "im_mark_read_msg" })).length, 0);
  assert.equal(a.parse(event(content(), { event: "im_receive_msg_eu" })).length, 0);
  assert.equal(a.parse(event(content(), { client_key: "KHAC" })).length, 0);
  assert.equal(a.parse(event("không phải json")).length, 0);
});

test("gửi chữ: dùng conversation_id, business_id = open_id, token ở header Access-Token", async () => {
  const { f, calls } = router({ "/business/message/send/": [sentOk("out1")] });
  const r = await mk(memTokens(fresh()), f).send({ channel, contactExternalId: "UID1", conversationExternalId: "CONV1", text: "chào bạn" });
  assert.deepEqual(r, { ok: true, externalId: "out1" });
  assert.equal((calls[0].init.headers as Record<string, string>)["Access-Token"], "AT1");
  assert.deepEqual(JSON.parse(calls[0].init.body as string), {
    business_id: "BIZ1", recipient_type: "CONVERSATION", recipient: "CONV1", message_type: "TEXT", text: { body: "chào bạn" },
  });
});

test("gửi ảnh: tải ảnh, upload lấy media_id rồi gửi IMAGE; chữ và ảnh là hai tin", async () => {
  const png = () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } });
  const { f, calls } = router({
    "http://x/a.png": [png],
    "/media/upload/": [json({ code: 0, data: { media_id: "MID9" } })],
    "/business/message/send/": [sentOk("t"), sentOk("i")],
  });
  const r = await mk(memTokens(fresh()), f).send({ channel, contactExternalId: "UID1", conversationExternalId: "CONV1", text: "xem nhé", attachments: [{ type: "image", url: "http://x/a.png" }] });
  assert.deepEqual(r, { ok: true, externalId: "i" });
  const upload = calls.find((c) => c.url.includes("/media/upload/"))!;
  assert.ok(upload.init.body instanceof FormData);
  assert.equal((upload.init.body as FormData).get("media_type"), "IMAGE");
  const sends = calls.filter((c) => c.url.includes("/business/message/send/")).map((c) => JSON.parse(c.init.body as string));
  assert.equal(sends[0].message_type, "TEXT");
  assert.deepEqual(sends[1].image, { media_id: "MID9" });
  assert.equal(sends[1].text, undefined);
});

test("gửi ảnh: từ chối sai định dạng, quá 3MB; tệp, tin rỗng, thiếu mã hội thoại", async () => {
  const gif = () => new Response("x", { headers: { "content-type": "image/gif" } });
  const big = () => new Response(new Uint8Array(3 * 1024 * 1024 + 1), { headers: { "content-type": "image/jpeg" } });
  const a1 = mk(memTokens(fresh()), router({ "http://x/g": [gif] }).f);
  assert.match((await a1.send({ channel, contactExternalId: "U", conversationExternalId: "C", attachments: [{ type: "image", url: "http://x/g" }] })).error!, /jpg hoặc png/);
  const a2 = mk(memTokens(fresh()), router({ "http://x/b": [big] }).f);
  assert.match((await a2.send({ channel, contactExternalId: "U", conversationExternalId: "C", attachments: [{ type: "image", url: "http://x/b" }] })).error!, /3MB/);
  const a = mk(memTokens(fresh()), router({}).f);
  assert.equal((await a.send({ channel, contactExternalId: "U", conversationExternalId: "C", attachments: [{ type: "file", url: "u" }] })).ok, false);
  assert.equal((await a.send({ channel, contactExternalId: "U", conversationExternalId: "C" })).ok, false);
  assert.equal((await a.send({ channel, contactExternalId: "U", text: "x" })).ok, false);
});

test("lỗi từ TikTok được báo kèm mã", async () => {
  const { f } = router({ "/business/message/send/": [json({ code: 40001, message: "Out of window" })] });
  const r = await mk(memTokens(fresh()), f).send({ channel, contactExternalId: "U", conversationExternalId: "C", text: "x" });
  assert.equal(r.ok, false);
  assert.match(r.error!, /40001/);
});

test("token sắp hết hạn: làm mới (JSON, client_id/secret) rồi lưu; giữ refresh token cũ nếu không có mới", async () => {
  const tokens = memTokens(fresh({ accessExpiresAt: NOW + 1000 }));
  const { f, calls } = router({
    "/tt_user/oauth2/refresh_token/": [json({ code: 0, data: { access_token: "AT2", expires_in: 86400 } })],
    "/business/message/send/": [sentOk()],
  });
  assert.equal((await mk(tokens, f).send({ channel, contactExternalId: "U", conversationExternalId: "C", text: "x" })).ok, true);
  assert.deepEqual(JSON.parse(calls[0].init.body as string), { client_id: "KEY", client_secret: "SEC", grant_type: "refresh_token", refresh_token: "RT1" });
  assert.equal(tokens.cur!.accessToken, "AT2");
  assert.equal(tokens.cur!.refreshToken, "RT1");
  assert.equal((calls[1].init.headers as Record<string, string>)["Access-Token"], "AT2");
});

test("gửi song song khi token hết hạn: chỉ làm mới một lần", async () => {
  const tokens = memTokens(fresh({ accessExpiresAt: NOW + 1000 }));
  const { f, calls } = router({
    "/tt_user/oauth2/refresh_token/": [json({ code: 0, data: { access_token: "AT2", refresh_token: "RT2", expires_in: 86400, refresh_token_expires_in: 31536000 } })],
    "/business/message/send/": [sentOk("1"), sentOk("2")],
  });
  const a = mk(tokens, f);
  const rs = await Promise.all([
    a.send({ channel, contactExternalId: "U", conversationExternalId: "C", text: "a" }),
    a.send({ channel, contactExternalId: "U", conversationExternalId: "D", text: "b" }),
  ]);
  assert.ok(rs.every((r) => r.ok));
  assert.equal(calls.filter((c) => c.url.includes("refresh_token")).length, 1);
  assert.equal(tokens.cur!.refreshToken, "RT2");
});

test("token hết hạn giữa chừng: làm mới rồi thử lại một lần; refresh hết hạn thì báo kết nối lại", async () => {
  const tokens = memTokens(fresh());
  const { f, calls } = router({
    "/business/message/send/": [json({ code: 40105, message: "Access token expired" }), sentOk("ok")],
    "/tt_user/oauth2/refresh_token/": [json({ code: 0, data: { access_token: "AT2", expires_in: 86400 } })],
  });
  assert.deepEqual(await mk(tokens, f).send({ channel, contactExternalId: "U", conversationExternalId: "C", text: "x" }), { ok: true, externalId: "ok" });
  assert.equal(calls.length, 3);
  const dead = memTokens(fresh({ accessExpiresAt: NOW - 1, refreshExpiresAt: NOW - 1 }));
  assert.equal((await mk(dead, router({}).f).send({ channel, contactExternalId: "U", conversationExternalId: "C", text: "x" })).ok, false);
});

test("connect: đổi auth_code, trả open_id và lưu token", async () => {
  const tokens = memTokens(null);
  const { f, calls } = router({
    "/tt_user/oauth2/token/": [json({ code: 0, data: { access_token: "A", refresh_token: "R", expires_in: 86400, refresh_token_expires_in: 31536000, open_id: "OPEN1" } })],
  });
  assert.deepEqual(await mk(tokens, f).connect("t1", "CODE", "https://app/cb"), { openId: "OPEN1" });
  assert.deepEqual(JSON.parse(calls[0].init.body as string), { client_id: "KEY", client_secret: "SEC", grant_type: "authorization_code", auth_code: "CODE", redirect_uri: "https://app/cb" });
  assert.equal(tokens.cur!.refreshToken, "R");
  assert.equal(tokens.cur!.refreshExpiresAt, NOW + 31536000 * 1000);
  assert.equal(await mk(memTokens(null), router({ "/token/": [json({ code: 40002, message: "bad code" })] }).f).connect("t1", "X", "u"), null);
});

test("resolveMedia: lấy link tải ảnh và header x-user", async () => {
  const { f, calls } = router({ "/media/download/": [json({ code: 0, data: { download_url: "https://cdn/x" } })] });
  const r = await mk(memTokens(fresh()), f).resolveMedia(channel, "tiktok-media://CONV1/MSG1/MEDIA1");
  assert.deepEqual(r, { url: "https://cdn/x", headers: { "x-user": "AT1" } });
  assert.deepEqual(JSON.parse(calls[0].init.body as string), { business_id: "BIZ1", conversation_id: "CONV1", message_id: "MSG1", media_id: "MEDIA1", media_type: "IMAGE" });
  assert.equal(await mk(memTokens(fresh()), router({}).f).resolveMedia(channel, "http://khong-phai-ref"), null);
});

test("lõi: hạn mức 10 tin mỗi cửa sổ và cửa sổ 48 giờ", async () => {
  registerAdapter(mk(memTokens(fresh()), router({ "/business/message/send/": Array.from({ length: 5 }, () => sentOk()) }).f));
  const base = { channel, contactExternalId: "U", conversationExternalId: "C", text: "x", lastInboundAt: NOW - 1000, now: NOW };
  assert.equal((await sendMessage({ ...base, repliesSinceInbound: 9 })).ok, true);
  const over = await sendMessage({ ...base, repliesSinceInbound: 10 });
  assert.equal(over.ok, false);
  assert.match(over.error!, /10 tin/);
  assert.equal((await sendMessage({ ...base, lastInboundAt: NOW - 49 * 3600_000 })).ok, false);
});

test("ingest: lưu mã hội thoại TikTok vào hội thoại", async () => {
  const mem = { db: { channels: { t1: channel }, contacts: {}, conversations: {}, messages: {} } as DB,
    async load() { return structuredClone(mem.db); }, async save(d: DB) { mem.db = d; } } as Store & { db: DB };
  const a = mk(memTokens(null), router({}).f);
  await ingest(mem, "tiktok", a.parse(event(content())));
  assert.equal(mem.db.conversations["t1:conv:UID1"].externalId, "CONV1");
  assert.equal(mem.db.contacts["t1:UID1"].name, "khach_a");
});
