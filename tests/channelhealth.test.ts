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
  assert.deepEqual(h.b, { ok: true, transient: true, error: "mất mạng" }, "lỗi mạng: chưa kết luận token hỏng");
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

test("sức khoẻ có khóa ứng dụng: dùng debug_token; thiếu pages_read_engagement KHÔNG phải token hỏng (lỗi #100 của /me)", async () => {
  const s = memStore([mk("a"), mk("b"), mk("c"), mk("d")]);
  const st = staticTokens(s);
  await st.save("a", "OK"); await st.save("b", "THIEU_RE"); await st.save("c", "HONG"); await st.save("d", "KO_NHAN_TIN");
  const calls: string[] = [];
  const all = ["pages_messaging", "pages_read_engagement", "pages_manage_metadata", "pages_show_list"];
  const f = (async (url: string, init: RequestInit) => {
    calls.push(url);
    const auth = (init.headers as Record<string, string>).authorization;
    if (url.includes("/debug_token")) {
      assert.equal(auth, "Bearer APP|SECRET", "debug_token gọi bằng token ứng dụng");
      const t = new URL(url).searchParams.get("input_token");
      const data = t === "HONG" ? { is_valid: false, error: { message: "Session has expired" } }
        : t === "THIEU_RE" ? { is_valid: true, scopes: all.filter((x) => x !== "pages_read_engagement") }
        : t === "KO_NHAN_TIN" ? { is_valid: true, scopes: ["pages_show_list"] }
        : { is_valid: true, scopes: all };
      return new Response(JSON.stringify({ data }), { status: 200 });
    }
    if (url.includes("/subscribed_apps")) return new Response(JSON.stringify({ data: [{ id: "APP" }] }), { status: 200 });
    // /me với token thiếu quyền trả lỗi #100 như Meta thật: không được dùng để kết luận
    return new Response(JSON.stringify({ error: { code: 100, message: "requires the 'pages_read_engagement' permission" } }), { status: 400 });
  }) as unknown as typeof fetch;
  const h = await checkMetaHealth(s, { appId: "APP", appSecret: "SECRET", fetchImpl: f });
  assert.deepEqual(h.a, { ok: true, subscribed: true });
  assert.deepEqual(h.b, { ok: true, subscribed: true, missing: ["pages_read_engagement"] });
  assert.equal(h.c.ok, false);
  assert.match(h.c.error!, /hết hạn hoặc bị thu hồi.*Session has expired/);
  assert.equal(h.d.ok, false);
  assert.match(h.d.error!, /thiếu quyền pages_messaging/);
  assert.ok(!calls.some((u) => u.includes("/me?")), "không gọi /me khi có khóa ứng dụng");
});

test("không có khóa ứng dụng: /me lỗi #100 (thiếu quyền) không bị coi là token hỏng; chỉ #190 mới hỏng", async () => {
  const s = memStore([mk("a"), mk("b")]);
  await staticTokens(s).save("a", "A"); await staticTokens(s).save("b", "B");
  const f = (async (url: string, init: RequestInit) => {
    const tok = (init.headers as Record<string, string>).authorization;
    const code = tok.endsWith("A") ? 100 : 190;
    return new Response(JSON.stringify({ error: { code, message: "x" } }), { status: 400 });
  }) as unknown as typeof fetch;
  const h = await checkMetaHealth(s, { fetchImpl: f });
  assert.equal(h.a.ok, true);
  assert.equal(h.a.transient, true);
  assert.deepEqual(h.b, { ok: false, error: "Token hết hạn hoặc bị thu hồi" });
});
