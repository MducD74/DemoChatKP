import test from "node:test";
import assert from "node:assert/strict";
import type { DB, Store } from "../src/core/store";
import { staticTokens } from "../src/core/token-store";
import { configureWebhook, runChecks, type Check, type MetaEnv, PAGE_FIELDS } from "../src/core/metacheck";

const mem = () => {
  const s = { db: { channels: {}, contacts: {}, conversations: {}, messages: {} } as DB,
    async load() { return structuredClone(s.db); }, async save(d: DB) { s.db = d; } };
  return s as Store & { db: DB };
};
const ENV: MetaEnv = { META_APP_ID: "APP1", META_APP_SECRET: "SEC1", META_VERIFY_TOKEN: "VT", KPCHAT_PUBLIC_URL: "https://x.trycloudflare.com", KPCHAT_ACCESS_KEY: "k".repeat(24), KPCHAT_SECRET_KEY: "s".repeat(32) };
type R = { status?: number; body: unknown; text?: string };
function net(routes: Array<[RegExp, (url: string, init?: RequestInit) => R | Promise<R>]>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    for (const [re, h] of routes) if (re.test(url)) { const r = await h(url, init); return new Response(r.text ?? JSON.stringify(r.body), { status: r.status ?? 200 }); }
    throw new Error("không có route " + url);
  }) as unknown as typeof fetch;
  return { f, calls };
}
const reach = [/hub\.challenge/, (u: string) => ({ body: "", text: new URL(u).searchParams.get("hub.challenge")! })] as [RegExp, (u: string) => R];
const appOk = [/graph\.facebook\.com\/v27\.0\/APP1\?/, () => ({ body: { name: "KP Chat" } })] as [RegExp, () => R];
const subs = (data: unknown[]) => [/APP1\/subscriptions\?/, () => ({ body: { data } })] as [RegExp, () => R];
const by = (cs: Check[], id: string) => cs.find((c) => c.id === id)!;

test("cấu hình webhook: gọi POST /{app}/subscriptions đúng tham số, token ứng dụng ở body (không ở URL)", async () => {
  const { f, calls } = net([[/APP1\/subscriptions/, () => ({ body: { success: true } })]]);
  assert.deepEqual(await configureWebhook(ENV, f), { ok: true });
  assert.equal(calls[0].init!.method, "POST");
  assert.ok(!calls[0].url.includes("SEC1"));
  const b = new URLSearchParams(calls[0].init!.body as string);
  assert.equal(b.get("object"), "page");
  assert.equal(b.get("callback_url"), "https://x.trycloudflare.com/api/webhook/facebook");
  assert.equal(b.get("fields"), PAGE_FIELDS.join(","));
  assert.equal(b.get("verify_token"), "VT");
  assert.equal(b.get("access_token"), "APP1|SEC1");
  assert.ok(PAGE_FIELDS.includes("messages") && PAGE_FIELDS.includes("message_echoes"));
});

test("cấu hình webhook: từ chối khi thiếu khóa, địa chỉ không phải https, hoặc Meta báo lỗi", async () => {
  const { f, calls } = net([[/subscriptions/, () => ({ status: 400, body: { error: { message: "callback không xác minh được" } } })]]);
  assert.equal((await configureWebhook({ ...ENV, META_APP_SECRET: "" }, f)).ok, false);
  assert.equal((await configureWebhook({ ...ENV, KPCHAT_PUBLIC_URL: "http://localhost:3031" }, f)).ok, false);
  assert.equal(calls.length, 0); // không gọi Meta khi cấu hình sai
  const r = await configureWebhook(ENV, f);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /không xác minh/);
});

test("kiểm tra: thiếu khóa và chưa có địa chỉ công khai thì báo đúng từng điều kiện, không gọi Meta", async () => {
  const s = mem();
  const { f, calls } = net([]);
  const cs = await runChecks(s, {}, f);
  assert.equal(by(cs, "env").level, "bad");
  assert.match(by(cs, "env").detail, /META_APP_ID.*META_APP_SECRET.*META_VERIFY_TOKEN/);
  assert.equal(by(cs, "public").level, "bad");
  assert.equal(calls.length, 0);
  const local = await runChecks(s, { ...ENV, KPCHAT_PUBLIC_URL: "http://localhost:3031" }, f);
  assert.equal(by(local, "public").level, "bad");
});

test("kiểm tra: cấu hình đúng hết thì tất cả đạt; có gọi thử địa chỉ công khai đúng cách Meta xác minh", async () => {
  const s = mem();
  s.db.channels["fb1"] = { id: "fb1", companyId: "c", kind: "facebook", externalId: "P1", name: "Fan", sendEnabled: false };
  await staticTokens(s).save("fb1", "PT1");
  const { f, calls } = net([
    reach, appOk,
    subs([{ object: "page", callback_url: "https://x.trycloudflare.com/api/webhook/facebook", fields: PAGE_FIELDS.map((name) => ({ name })), active: true }]),
    [/P1\/subscribed_apps/, () => ({ body: { data: [{ id: "APP1", subscribed_fields: ["messages", "message_echoes"] }] } })],
  ]);
  const cs = await runChecks(s, ENV, f);
  for (const id of ["env", "public", "reach", "app", "sub", "page-fb1"]) assert.equal(by(cs, id).level, "ok", id + ": " + by(cs, id).detail);
  assert.ok(!JSON.stringify(cs).includes("SEC1") && !JSON.stringify(cs).includes("PT1")); // không lộ bí mật
  assert.ok(calls.some((c) => c.url.startsWith("https://x.trycloudflare.com/api/webhook/facebook?") && c.url.includes("hub.verify_token=VT")));
  const tokenCall = calls.find((c) => /P1\/subscribed_apps/.test(c.url))!;
  assert.equal((tokenCall.init!.headers as Record<string, string>).authorization, "Bearer PT1");
  assert.ok(!tokenCall.url.includes("PT1"));
});

test("kiểm tra: đường hầm chết, webhook trỏ địa chỉ cũ, thiếu message_echoes, bị tắt", async () => {
  const s = mem();
  const dead = net([[/hub\.challenge/, () => { throw new Error("ECONNREFUSED"); }], appOk, subs([])]);
  const a = await runChecks(s, ENV, dead.f);
  assert.equal(by(a, "reach").level, "bad");
  assert.match(by(a, "reach").detail, /đường hầm|địa chỉ/i);
  assert.equal(by(a, "sub").level, "bad"); // chưa có webhook Page
  const old = await runChecks(s, ENV, net([reach, appOk, subs([{ object: "page", callback_url: "https://cu.trycloudflare.com/api/webhook/facebook", fields: PAGE_FIELDS, active: true }])]).f);
  assert.equal(by(old, "sub").level, "bad");
  assert.match(by(old, "sub").detail, /cu\.trycloudflare\.com/);
  const few = await runChecks(s, ENV, net([reach, appOk, subs([{ object: "page", callback_url: "https://x.trycloudflare.com/api/webhook/facebook", fields: ["messages"], active: true }])]).f);
  assert.equal(by(few, "sub").level, "warn");
  assert.match(by(few, "sub").detail, /message_echoes/);
  const off = await runChecks(s, ENV, net([reach, appOk, subs([{ object: "page", callback_url: "https://x.trycloudflare.com/api/webhook/facebook", fields: PAGE_FIELDS, active: false }])]).f);
  assert.equal(by(off, "sub").level, "bad");
});

test("kiểm tra: khóa ứng dụng sai, và các lỗi của từng Page (thiếu token, token hết hiệu lực, chưa đăng ký, thiếu messages)", async () => {
  const s = mem();
  for (const [id, ext] of [["a", "PA"], ["b", "PB"], ["c", "PC"], ["d", "PD"], ["e", "PE"]]) s.db.channels[id] = { id, companyId: "c", kind: "facebook", externalId: ext, name: "Page " + id, sendEnabled: false };
  for (const id of ["b", "c", "d", "e"]) await staticTokens(s).save(id, "T" + id);
  const { f } = net([
    reach,
    [/APP1\?/, () => ({ status: 400, body: { error: { message: "Invalid client secret" } } })],
    [/APP1\/subscriptions/, () => ({ status: 400, body: { error: { message: "x" } } })],
    [/PB\/subscribed_apps/, () => ({ status: 400, body: { error: { message: "Error validating access token" } } })],
    [/PC\/subscribed_apps/, () => ({ body: { data: [] } })],
    [/PD\/subscribed_apps/, () => ({ body: { data: [{ id: "APP1", subscribed_fields: ["message_reads"] }] } })],
    [/PE\/subscribed_apps/, () => ({ body: { data: [{ id: "APP1", subscribed_fields: ["messages"] }] } })],
  ]);
  const cs = await runChecks(s, ENV, f);
  assert.equal(by(cs, "app").level, "bad");
  assert.match(by(cs, "app").detail, /Invalid client secret/);
  assert.equal(by(cs, "sub").level, "warn"); // chưa đọc được: gợi ý tự cấu hình
  assert.equal(by(cs, "page-a").level, "bad"); assert.match(by(cs, "page-a").title, /chưa có token/);
  assert.equal(by(cs, "page-b").level, "bad"); assert.match(by(cs, "page-b").title, /token không còn dùng được/);
  assert.equal(by(cs, "page-c").level, "bad"); assert.match(by(cs, "page-c").title, /chưa đăng ký nhận tin/);
  assert.equal(by(cs, "page-d").level, "bad"); assert.match(by(cs, "page-d").title, /messages/);
  assert.equal(by(cs, "page-e").level, "ok");
});

test("kiểm tra: Instagram nhắc làm ở App Dashboard; không có Page thì báo thông tin; kênh đã gỡ bị bỏ qua", async () => {
  const s = mem();
  s.db.channels["i"] = { id: "i", companyId: "c", kind: "instagram", externalId: "IG", name: "IG", sendEnabled: false };
  s.db.channels["old"] = { id: "old", companyId: "c", kind: "facebook", externalId: "PO", name: "Cũ", sendEnabled: false, off: true };
  const cs = await runChecks(s, ENV, net([reach, appOk, subs([])]).f);
  assert.equal(by(cs, "ig").level, "info");
  assert.equal(by(cs, "pages").level, "info");
  assert.ok(!cs.some((c) => c.id === "page-old"));
});

test("kiểm tra Instagram: token, Page liên kết, đăng ký nhận tin; nhắc hai việc Meta không cho kiểm bằng API", async () => {
  const s = mem();
  const mkIg = (id: string, extra: object = {}) => { s.db.channels[id] = { id, companyId: "c", kind: "instagram", externalId: "IG" + id, name: "IG " + id, sendEnabled: false, meta: { pageId: "P" + id }, ...extra }; };
  mkIg("a"); mkIg("b"); mkIg("c"); mkIg("d"); mkIg("e", { meta: undefined });
  for (const id of ["b", "c", "d", "e"]) await staticTokens(s).save(id, "T" + id);
  const { f } = net([
    reach, appOk, subs([]),
    [/Pb\/subscribed_apps/, () => ({ status: 400, body: { error: { message: "Error validating access token" } } })],
    [/Pc\/subscribed_apps/, () => ({ body: { data: [] } })],
    [/Pd\/subscribed_apps/, () => ({ body: { data: [{ id: "APP1", subscribed_fields: ["messages"] }] } })],
  ]);
  const cs = await runChecks(s, ENV, f);
  assert.match(by(cs, "ig-a").title, /chưa có token/);
  assert.match(by(cs, "ig-b").title, /token không còn dùng được/);
  assert.match(by(cs, "ig-c").title, /chưa đăng ký nhận tin/);
  assert.equal(by(cs, "ig-d").level, "ok");
  assert.match(by(cs, "ig-d").detail, /Cho phép truy cập tin nhắn/);
  assert.match(by(cs, "ig-e").title, /thiếu Page liên kết/);
  assert.match(by(cs, "ig").detail, /Cho phép truy cập tin nhắn/);
  assert.match(by(cs, "ig").detail, /\/api\/webhook\/instagram/);
});
