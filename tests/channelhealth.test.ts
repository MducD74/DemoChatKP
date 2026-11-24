import test from "node:test";
import assert from "node:assert/strict";
import { checkMetaHealth } from "../src/core/metahealth";
import { metaLoginUrl } from "../src/core/metalogin";
import { setChannelName } from "../src/core/service";
import { staticTokens } from "../src/core/token-store";
import type { DB, Store } from "../src/core/store";
import type { Channel } from "../src/core/types";

const mk = (id: string, over: Partial<Channel> = {}): Channel => ({ id, companyId: "co", kind: "facebook", externalId: "P_" + id, name: id, sendEnabled: false, ...over });
const memStore = (chs: Channel[]): Store & { db: DB } => {
  const s = { db: { channels: Object.fromEntries(chs.map((c) => [c.id, c])), contacts: {}, conversations: {}, messages: {} } as DB,
    async load() { return structuredClone(s.db); }, async save(d: DB) { s.db = d; } };
  return s;
};

test("sức khoẻ kênh Meta: token tốt, token hết hạn, thiếu token, đã đăng ký nhận tin hay chưa", async () => {
  const s = memStore([mk("a"), mk("b"), mk("c"), mk("ig", { kind: "instagram", externalId: "IG1", meta: { pageId: "P_a" } }), mk("off", { off: true })]);
  const st = staticTokens(s);
  await st.save("a", "TOK_A"); await st.save("b", "TOK_B"); await st.save("ig", "TOK_A");
  const calls: string[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push(url);
    const tok = (init.headers as Record<string, string>).authorization;
    if (url.includes("/me?")) return tok.endsWith("TOK_B") ? new Response(JSON.stringify({ error: { code: 190, message: "x" } }), { status: 400 }) : new Response(JSON.stringify({ id: "P" }), { status: 200 });
    if (url.includes("/subscribed_apps")) return new Response(JSON.stringify({ data: [{ id: "APP" }] }), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  const h = await checkMetaHealth(s, { appId: "APP", fetchImpl: f });
  assert.deepEqual(h.a, { ok: true, subscribed: true });
  assert.deepEqual(h.b, { ok: false, error: "Token hết hạn hoặc bị thu hồi" });
  assert.deepEqual(h.ig, { ok: true }); // Instagram dùng token Page, không kiểm đăng ký riêng
  assert.equal(h.c, undefined); // chưa có token: không gọi Meta
  assert.equal(h.off, undefined);
  assert.equal(calls.filter((u) => u.includes("P_c")).length, 0);
});

test("sức khoẻ: Page chưa đăng ký app, và Meta lỗi mạng", async () => {
  const s = memStore([mk("a"), mk("b")]);
  await staticTokens(s).save("a", "T1"); await staticTokens(s).save("b", "T2");
  const f = (async (url: string, init: RequestInit) => {
    const tok = (init.headers as Record<string, string>).authorization;
    if (tok.endsWith("T2")) throw new Error("mất mạng");
    if (url.includes("/me?")) return new Response(JSON.stringify({ id: "P" }), { status: 200 });
    return new Response(JSON.stringify({ data: [{ id: "APP-KHAC" }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const h = await checkMetaHealth(s, { appId: "APP", fetchImpl: f });
  assert.equal(h.a.subscribed, false);
  assert.deepEqual(h.b, { ok: false, error: "mất mạng" });
});

test("đổi tên kênh: kiểm tên rỗng, quá dài và kênh không có", async () => {
  const s = memStore([mk("a")]);
  assert.deepEqual(await setChannelName(s, "a", "  Zalo Lan - Sale 1  "), { ok: true });
  assert.equal(s.db.channels.a.name, "Zalo Lan - Sale 1");
  assert.equal((await setChannelName(s, "a", "   ")).ok, false);
  assert.equal((await setChannelName(s, "a", "x".repeat(81))).ok, false);
  assert.equal((await setChannelName(s, "khong-co", "A")).ok, false);
});

test("đăng nhập Facebook: chỉ thêm auth_type=rerequest khi yêu cầu chọn lại quyền", () => {
  const base = { appId: "1", appSecret: "s", redirectUri: "http://localhost:3031/cb", configId: "CFG" };
  assert.equal(new URL(metaLoginUrl(base, "st")).searchParams.has("auth_type"), false);
  assert.equal(new URL(metaLoginUrl({ ...base, rerequest: true }, "st")).searchParams.get("auth_type"), "rerequest");
});
