import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createZaloAdapter } from "../src/adapters/zalo";
import { encryptJson, decryptJson } from "../src/core/secret";
import { storeBackedTokens, type ChannelTokens, type TokenStore } from "../src/core/token-store";
import type { DB, Store } from "../src/core/store";
import type { Channel } from "../src/core/types";

const channel: Channel = { id: "z1", companyId: "co", kind: "zalo_oa", externalId: "OA1", name: "OA", sendEnabled: true };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function memTokens(t: ChannelTokens | null): TokenStore & { cur: ChannelTokens | null; saves: number } {
  const s = { cur: t, saves: 0, async get() { return s.cur; }, async save(_: string, n: ChannelTokens) { s.cur = n; s.saves++; } };
  return s;
}
const NOW = 1_000_000_000_000;
const fresh = (over: Partial<ChannelTokens> = {}): ChannelTokens => ({
  accessToken: "AT1", refreshToken: "RT1", accessExpiresAt: NOW + 3600_000, refreshExpiresAt: NOW + 80 * 86400_000, ...over,
});

// fetch giả: ghi lại lệnh gọi, trả theo hàng đợi
function fakeFetch(replies: Array<(url: string, init: RequestInit) => unknown>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = replies.shift();
    return new Response(JSON.stringify(r ? r(url, init) : {}), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const ok = (id = "mid1") => () => ({ error: 0, message: "Success", data: { message_id: id } });
const mk = (tokens: TokenStore, f: typeof fetch) =>
  createZaloAdapter({ appId: "APP", appSecret: "SEC", tokens, fetchImpl: f, now: () => NOW });

const body = (over: object = {}) => JSON.stringify({
  app_id: "APP", sender: { id: "U1" }, recipient: { id: "OA1" }, event_name: "user_send_text",
  message: { text: "xin chào", msg_id: "m1" }, timestamp: "1700000000000", ...over,
});

test("chữ ký webhook: sha256(appId + body + timestamp + secret)", () => {
  const a = mk(memTokens(null), fakeFetch([]).f);
  const raw = body();
  const sig = sha("APP" + raw + "1700000000000" + "SEC");
  assert.equal(a.verify(new Headers({ "x-zevent-signature": sig }), raw), true);
  assert.equal(a.verify(new Headers({ "x-zevent-signature": "mac=" + sig }), raw), true);
  assert.equal(a.verify(new Headers({ "x-zevent-signature": sha("sai") }), raw), false);
  assert.equal(a.verify(new Headers(), raw), false);
  assert.equal(a.verify(new Headers({ "x-zevent-signature": sig }), raw + " "), false);
});

test("parse: tin chữ, ảnh, file; bỏ sự kiện khác và app khác", () => {
  const a = mk(memTokens(null), fakeFetch([]).f);
  const t = a.parse(JSON.parse(body()));
  assert.equal(t.length, 1);
  assert.equal(t[0].channelExternalId, "OA1");
  assert.equal(t[0].contact.externalId, "U1");
  assert.equal(t[0].message.text, "xin chào");
  assert.equal(t[0].message.externalId, "m1");
  const img = a.parse(JSON.parse(body({ event_name: "user_send_image", message: { msg_id: "m2", attachments: [{ type: "image", payload: { url: "http://x/a.jpg", thumbnail: "t" } }] } })));
  assert.deepEqual(img[0].message.attachments, [{ type: "image", url: "http://x/a.jpg" }]);
  const file = a.parse(JSON.parse(body({ event_name: "user_send_file", message: { msg_id: "m3", attachments: [{ type: "file", payload: { url: "http://x/f", name: "a.docx" } }] } })));
  assert.deepEqual(file[0].message.attachments, [{ type: "file", url: "http://x/f", name: "a.docx" }]);
  const loc = a.parse(JSON.parse(body({ event_name: "user_send_location", message: { msg_id: "m4", attachments: [{ type: "location", payload: { coordinates: { latitude: "10.7", longitude: "106.6" } } }] } })));
  assert.match(loc[0].message.text, /10\.7, 106\.6/);
  assert.equal(a.parse(JSON.parse(body({ event_name: "follow" }))).length, 0);
  assert.equal(a.parse(JSON.parse(body({ app_id: "KHAC" }))).length, 0);
});

test("gửi: chữ và ảnh thành hai tin, token ở header access_token", async () => {
  const { f, calls } = fakeFetch([ok("a"), ok("b")]);
  const r = await mk(memTokens(fresh()), f).send({ channel, contactExternalId: "U1", text: "hi", attachments: [{ type: "image", url: "http://x/i.jpg" }] });
  assert.deepEqual(r, { ok: true, externalId: "b" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://openapi.zalo.me/v3.0/oa/message/cs");
  assert.equal((calls[0].init.headers as Record<string, string>).access_token, "AT1");
  assert.deepEqual(JSON.parse(calls[0].init.body as string), { recipient: { user_id: "U1" }, message: { text: "hi" } });
  const img = JSON.parse(calls[1].init.body as string).message.attachment.payload;
  assert.deepEqual(img, { template_type: "media", elements: [{ media_type: "image", url: "http://x/i.jpg" }] });
});

test("gửi: lỗi từ Zalo, tin rỗng, tệp chưa hỗ trợ, chưa có token", async () => {
  const bad = fakeFetch([() => ({ error: -201, message: "Out of window" })]);
  const r = await mk(memTokens(fresh()), bad.f).send({ channel, contactExternalId: "U1", text: "x" });
  assert.equal(r.ok, false);
  assert.match(r.error!, /-201/);
  const a = mk(memTokens(fresh()), fakeFetch([]).f);
  assert.equal((await a.send({ channel, contactExternalId: "U1" })).ok, false);
  assert.equal((await a.send({ channel, contactExternalId: "U1", attachments: [{ type: "file", url: "u" }] })).ok, false);
  assert.equal((await mk(memTokens(null), fakeFetch([]).f).send({ channel, contactExternalId: "U1", text: "x" })).ok, false);
});

test("token sắp hết hạn: làm mới trước khi gửi và lưu cặp mới (refresh token dùng một lần)", async () => {
  const tokens = memTokens(fresh({ accessExpiresAt: NOW + 60_000 }));
  const { f, calls } = fakeFetch([() => ({ access_token: "AT2", refresh_token: "RT2", expires_in: "90000" }), ok()]);
  const r = await mk(tokens, f).send({ channel, contactExternalId: "U1", text: "x" });
  assert.equal(r.ok, true);
  assert.equal(calls[0].url, "https://oauth.zaloapp.com/v4/oa/access_token");
  assert.equal((calls[0].init.headers as Record<string, string>).secret_key, "SEC");
  const form = new URLSearchParams(calls[0].init.body as string);
  assert.equal(form.get("grant_type"), "refresh_token");
  assert.equal(form.get("refresh_token"), "RT1");
  assert.equal(form.get("app_id"), "APP");
  assert.equal(tokens.cur!.accessToken, "AT2");
  assert.equal(tokens.cur!.refreshToken, "RT2");
  assert.equal(tokens.cur!.accessExpiresAt, NOW + 90000 * 1000);
  assert.equal((calls[1].init.headers as Record<string, string>).access_token, "AT2");
});

test("gửi song song khi token hết hạn: chỉ làm mới một lần", async () => {
  const tokens = memTokens(fresh({ accessExpiresAt: NOW + 1000 }));
  const { f, calls } = fakeFetch([() => ({ access_token: "AT2", refresh_token: "RT2", expires_in: "90000" }), ok("1"), ok("2")]);
  const a = mk(tokens, f);
  const [r1, r2] = await Promise.all([
    a.send({ channel, contactExternalId: "U1", text: "a" }),
    a.send({ channel, contactExternalId: "U2", text: "b" }),
  ]);
  assert.equal(r1.ok && r2.ok, true);
  assert.equal(calls.filter((c) => c.url.includes("oauth")).length, 1);
  assert.equal(tokens.saves, 1);
});

test("Zalo báo token sai: làm mới rồi thử lại đúng một lần", async () => {
  const tokens = memTokens(fresh());
  const { f, calls } = fakeFetch([
    () => ({ error: -216, message: "Access token is invalid" }),
    () => ({ access_token: "AT2", refresh_token: "RT2", expires_in: "90000" }),
    ok("z"),
  ]);
  const r = await mk(tokens, f).send({ channel, contactExternalId: "U1", text: "x" });
  assert.deepEqual(r, { ok: true, externalId: "z" });
  assert.equal(calls.length, 3);
});

test("refresh token hết hạn hoặc bị từ chối: báo cần kết nối lại, không lưu gì", async () => {
  const dead = memTokens(fresh({ accessExpiresAt: NOW - 1, refreshExpiresAt: NOW - 1 }));
  const r1 = await mk(dead, fakeFetch([]).f).send({ channel, contactExternalId: "U1", text: "x" });
  assert.equal(r1.ok, false);
  const rej = memTokens(fresh({ accessExpiresAt: NOW - 1 }));
  const r2 = await mk(rej, fakeFetch([() => ({ error: -118, error_name: "invalid refresh token" })]).f).send({ channel, contactExternalId: "U1", text: "x" });
  assert.equal(r2.ok, false);
  assert.equal(rej.saves, 0);
});

test("connect: đổi authorization code lấy cặp token", async () => {
  const tokens = memTokens(null);
  const { f, calls } = fakeFetch([() => ({ access_token: "A", refresh_token: "R", expires_in: "90000" })]);
  assert.equal(await mk(tokens, f).connect("z1", "CODE", "VERIF"), true);
  const form = new URLSearchParams(calls[0].init.body as string);
  assert.equal(form.get("grant_type"), "authorization_code");
  assert.equal(form.get("code"), "CODE");
  assert.equal(form.get("code_verifier"), "VERIF");
  assert.equal(tokens.cur!.refreshToken, "R");
});

test("mã hóa token: khứ hồi, bản mã không chứa token, sai dữ liệu thì lỗi", async () => {
  const t = fresh();
  const blob = encryptJson(t);
  assert.ok(!blob.includes("AT1"));
  assert.deepEqual(decryptJson(blob), t);
  assert.throws(() => decryptJson(blob.slice(0, -4) + "AAAA"));
  const mem = { db: { channels: {}, contacts: {}, conversations: {}, messages: {} } as DB, async load() { return structuredClone(mem.db); }, async save(d: DB) { mem.db = d; } } as Store & { db: DB };
  const ts = storeBackedTokens(mem);
  await ts.save("z1", t);
  assert.ok(!JSON.stringify(mem.db).includes("RT1"));
  assert.deepEqual(await ts.get("z1"), t);
  assert.equal(await ts.get("khac"), null);
});

test("fetchProfile: GET user/detail với data JSON và header access_token, lấy display_name và ảnh 240", async () => {
  const { f, calls } = fakeFetch([() => ({ error: 0, message: "Success", data: { user_id: "U1", display_name: " Chị Hoa ", avatar: "https://a/full.jpg", avatars: { "120": "https://a/120.jpg", "240": "https://a/240.jpg" } } })]);
  const z = mk(memTokens(fresh()), f);
  assert.deepEqual(await z.fetchProfile!(channel, "U1"), { name: "Chị Hoa", avatarUrl: "https://a/240.jpg" });
  const u = new URL(calls[0].url);
  assert.equal(u.origin + u.pathname, "https://openapi.zalo.me/v3.0/oa/user/detail");
  assert.deepEqual(JSON.parse(u.searchParams.get("data")!), { user_id: "U1" });
  assert.equal(calls[0].init.method, "GET");
  assert.equal((calls[0].init.headers as Record<string, string>).access_token, "AT1");
});

test("fetchProfile: thiếu ảnh dùng avatar, thiếu tên dùng user_alias; lỗi hoặc chưa có token thì null", async () => {
  const a = fakeFetch([() => ({ error: 0, data: { user_alias: "Hoa", avatar: "https://a/f.jpg" } })]);
  assert.deepEqual(await mk(memTokens(fresh()), a.f).fetchProfile!(channel, "U1"), { name: "Hoa", avatarUrl: "https://a/f.jpg" });
  const b = fakeFetch([() => ({ error: -201, message: "uid is invalid" })]);
  assert.equal(await mk(memTokens(fresh()), b.f).fetchProfile!(channel, "U1"), null);
  const c = fakeFetch([]);
  assert.equal(await mk(memTokens(null), c.f).fetchProfile!(channel, "U1"), null);
  assert.equal(c.calls.length, 0);
  const d = fakeFetch([() => { throw new Error("mạng"); }]);
  assert.equal(await mk(memTokens(fresh()), d.f).fetchProfile!(channel, "U1"), null);
});

test("fetchProfile: token sai thì làm mới một lần rồi thử lại", async () => {
  const t = memTokens(fresh());
  const { f, calls } = fakeFetch([
    () => ({ error: -216, message: "Access token is invalid" }),
    () => ({ access_token: "AT2", refresh_token: "RT2", expires_in: "90000" }),
    () => ({ error: 0, data: { display_name: "Anh Nam" } }),
  ]);
  assert.deepEqual(await mk(t, f).fetchProfile!(channel, "U2"), { name: "Anh Nam", avatarUrl: undefined });
  assert.equal(calls.length, 3);
  assert.equal(t.cur!.accessToken, "AT2");
  assert.equal((calls[2].init.headers as Record<string, string>).access_token, "AT2");
});
