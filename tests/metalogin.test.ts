import test from "node:test";
import assert from "node:assert/strict";
import type { DB, Store } from "../src/core/store";
import { beginMetaLogin, consumeOAuth } from "../src/core/connect";
import { staticTokens } from "../src/core/token-store";
import { connectPages, createPickSession, diagLine, diagnoseLogin, readPickDiag, exchangeLogin, listPages, metaLoginUrl, pagesForUi, readPickSession, canMessage, LOGIN_SCOPES, type MetaPage } from "../src/core/metalogin";

const mem = () => {
  const s = { db: { channels: {}, contacts: {}, conversations: {}, messages: {} } as DB,
    async load() { return structuredClone(s.db); }, async save(d: DB) { s.db = d; } };
  return s as Store & { db: DB };
};
const cfg = { appId: "APP", appSecret: "SEC", redirectUri: "https://x/api/connect/meta/callback" };
type H = (url: string, init?: RequestInit) => unknown;
function router(routes: Array<[string, H]>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = routes.find(([k]) => url.includes(k));
    const body = r ? r[1](url, init) : { error: { message: "không có route" } };
    const status = (body as { error?: unknown }).error ? 400 : 200;
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const page = (id: string, extra: Partial<MetaPage> = {}): MetaPage => ({ id, name: "Page " + id, token: "PT" + id, tasks: ["MESSAGING", "MODERATE"], ...extra });

test("URL đăng nhập: dùng scope mặc định hoặc config_id (Facebook Login for Business), luôn có state và code", () => {
  const u = new URL(metaLoginUrl(cfg, "ST"));
  assert.equal(u.origin + u.pathname, "https://www.facebook.com/v27.0/dialog/oauth");
  assert.equal(u.searchParams.get("client_id"), "APP");
  assert.equal(u.searchParams.get("redirect_uri"), cfg.redirectUri);
  assert.equal(u.searchParams.get("state"), "ST");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("scope"), LOGIN_SCOPES.join(","));
  assert.ok(LOGIN_SCOPES.includes("pages_messaging") && LOGIN_SCOPES.includes("pages_show_list") && LOGIN_SCOPES.includes("pages_manage_metadata"));
  assert.ok(!u.search.includes("SEC")); // không lộ khóa bí mật
  const b = new URL(metaLoginUrl({ ...cfg, configId: "CFG1" }, "ST"));
  assert.equal(b.searchParams.get("config_id"), "CFG1");
  assert.equal(b.searchParams.get("scope"), null); // config_id thay cho scope
});

test("đổi mã: lấy token ngắn rồi đổi sang token dài hạn; lỗi ở bước nào báo đúng bước đó", async () => {
  const { f, calls } = router([
    ["fb_exchange_token", () => ({ access_token: "LONG", token_type: "bearer", expires_in: 5183944 })],
    ["code=CODE", () => ({ access_token: "SHORT", token_type: "bearer", expires_in: 3600 })],
  ]);
  const r = await exchangeLogin(cfg, "CODE", f);
  assert.deepEqual(r, { ok: true, token: "LONG" });
  const first = new URL(calls[0].url);
  assert.equal(first.searchParams.get("code"), "CODE");
  assert.equal(first.searchParams.get("redirect_uri"), cfg.redirectUri);
  assert.equal(first.searchParams.get("client_secret"), "SEC");
  const second = new URL(calls[1].url);
  assert.equal(second.searchParams.get("grant_type"), "fb_exchange_token");
  assert.equal(second.searchParams.get("fb_exchange_token"), "SHORT");
  const bad = await exchangeLogin(cfg, "X", router([["oauth/access_token", () => ({ error: { message: "code đã dùng" } })]]).f);
  assert.equal(bad.ok, false);
  assert.match((bad as { error: string }).error, /code đã dùng/);
  const half = await exchangeLogin(cfg, "CODE", router([["fb_exchange_token", () => ({ error: { message: "hết hạn" } })], ["code=CODE", () => ({ access_token: "S" })]]).f);
  assert.match((half as { error: string }).error, /dài hạn/);
});

test("liệt kê Page: lấy token Page, tác vụ, Instagram liên kết; đi theo trang kế tiếp nhưng chỉ trên Graph API; token người dùng ở header", async () => {
  const { f, calls } = router([
    ["page=2", () => ({ data: [{ id: "2", name: "B", access_token: "TB", tasks: ["MODERATE"] }] })],
    ["/me/accounts", () => ({
      data: [{ id: "1", name: "A", access_token: "TA", tasks: ["MESSAGING"], instagram_business_account: { id: "IG1", username: "shop" } }, { id: "x" }],
      paging: { next: "https://graph.facebook.com/v27.0/me/accounts?page=2" },
    })],
  ]);
  const r = await listPages("USERTOKEN", f);
  assert.ok(r.ok);
  assert.deepEqual(r.ok && r.pages.map((p) => p.id), ["1", "2"]); // dòng thiếu token bị bỏ
  assert.deepEqual(r.ok && r.pages[0].ig, { id: "IG1", username: "shop" });
  assert.equal((calls[0].init!.headers as Record<string, string>).authorization, "Bearer USERTOKEN");
  assert.ok(!calls[0].url.includes("USERTOKEN"));
  assert.match(calls[0].url, /fields=.*access_token.*tasks.*instagram_business_account/);
  // đường dẫn trang kế tiếp trỏ ra ngoài Graph API thì không đi theo
  const evil = router([["/me/accounts", () => ({ data: [{ id: "1", name: "A", access_token: "T" }], paging: { next: "https://evil.example/steal" } })]]);
  const e = await listPages("U", evil.f);
  assert.ok(e.ok && e.pages.length === 1);
  assert.equal(evil.calls.length, 1);
  assert.equal((await listPages("U", router([["/me/accounts", () => ({ error: { message: "token sai" } })]]).f)).ok, false);
  assert.equal(canMessage({ tasks: ["MODERATE"] }), false);
  assert.equal(canMessage({ tasks: undefined }), true);
});

test("phiên chọn Page: token lưu mã hóa, hết hạn sau 15 phút, giao diện không nhận được token", async () => {
  const s = mem();
  const id = await createPickSession(s, [page("1", { ig: { id: "IG1", username: "a" } })], 1000);
  assert.ok(!JSON.stringify(s.db).includes("PT1")); // mã hóa
  assert.equal((await readPickSession(s, id, 1000 + 14 * 60_000))!.length, 1);
  assert.equal(await readPickSession(s, id, 1000 + 16 * 60_000), null);
  const ui = await pagesForUi(s, id, 2000);
  assert.ok(!JSON.stringify(ui).includes("PT1"));
  assert.deepEqual([ui![0].connected, ui![0].igConnected, ui![0].canMessage], [false, false, true]);
  assert.equal(await pagesForUi(s, "khong-co"), null);
});

test("nối Page đã chọn: tạo kênh (tắt gửi tin), lưu token mã hóa, đăng ký nhận tin; Instagram dùng token Page; phiên dùng một lần", async () => {
  const s = mem();
  const id = await createPickSession(s, [page("1", { ig: { id: "IG1", username: "shop" } }), page("2")]);
  const { f, calls } = router([["/subscribed_apps", () => ({ success: true })]]);
  const r = await connectPages(s, id, [{ pageId: "1", instagram: true }], f);
  assert.ok(r.ok && r.results.length === 2 && r.results.every((x) => x.ok));
  const chans = Object.values(s.db.channels);
  assert.deepEqual(chans.map((c) => c.kind).sort(), ["facebook", "instagram"]);
  assert.ok(chans.every((c) => c.sendEnabled === false)); // luôn tắt gửi tin
  const ig = chans.find((c) => c.kind === "instagram")!;
  assert.equal(ig.externalId, "IG1");
  assert.equal(ig.meta?.pageId, "1");
  const fb = chans.find((c) => c.kind === "facebook")!;
  assert.equal(await staticTokens(s).get(fb.id), "PT1");
  assert.equal(await staticTokens(s).get(ig.id), "PT1");
  assert.ok(!JSON.stringify(s.db).includes("PT1\""));
  assert.equal(calls.filter((c) => /\/1\/subscribed_apps/.test(c.url)).length, 2);
  // Page 2 không được chọn nên không có kênh
  assert.ok(!chans.some((c) => c.externalId === "2"));
  // phiên đã dùng
  assert.equal((await connectPages(s, id, [{ pageId: "2" }], f)).ok, false);
});

test("nối lại Page đã có: chỉ cập nhật token, không tạo kênh trùng; Page thiếu quyền Nhắn tin hoặc không có trong danh sách bị từ chối; lỗi đăng ký không làm mất kênh", async () => {
  const s = mem();
  const id1 = await createPickSession(s, [page("1")]);
  await connectPages(s, id1, [{ pageId: "1" }], router([["/subscribed_apps", () => ({ success: true })]]).f);
  const id2 = await createPickSession(s, [page("1", { token: "MOI" }), page("2", { tasks: ["MODERATE"] })]);
  const r = await connectPages(s, id2, [{ pageId: "1" }, { pageId: "2" }, { pageId: "999" }], router([["/subscribed_apps", () => ({ error: { message: "chưa duyệt" } })]]).f);
  assert.ok(r.ok);
  assert.equal(Object.values(s.db.channels).length, 1); // không trùng
  const only = Object.values(s.db.channels)[0];
  assert.equal(await staticTokens(s).get(only.id), "MOI"); // token mới
  assert.ok(r.ok && r.results[0].ok && /chưa đăng ký nhận tin/.test(r.results[0].note)); // vẫn nối, báo lỗi đăng ký
  assert.ok(r.ok && !r.results[1].ok && /quyền Nhắn tin/.test(r.results[1].note));
  assert.ok(r.ok && !r.results[2].ok);
  assert.equal(Object.values(s.db.channels).some((c) => c.externalId === "2"), false);
});

test("state đăng nhập Facebook: dùng một lần, hết hạn sau 15 phút, sai loại bị từ chối", async () => {
  const s = mem();
  const st = await beginMetaLogin(s, 1000);
  assert.ok(await consumeOAuth(s, st, "facebook", 2000));
  assert.equal(await consumeOAuth(s, st, "facebook", 2000), null);
  const st2 = await beginMetaLogin(s, 1000);
  assert.equal(await consumeOAuth(s, st2, "facebook", 1000 + 16 * 60_000), null);
  const st3 = await beginMetaLogin(s, 1000);
  assert.equal(await consumeOAuth(s, st3, "tiktok", 1500), null);
});

const subOk = router([["/subscribed_apps", () => ({ success: true })]]).f;

test("nối lại Page từng gỡ kết nối: mở lại kênh cũ (giữ lịch sử và mã kênh), tắt gửi tin, không tạo kênh trùng", async () => {
  const s = mem();
  await connectPages(s, await createPickSession(s, [page("1", { ig: { id: "IG1" } })]), [{ pageId: "1", instagram: true }], subOk);
  const [fb, ig] = [Object.values(s.db.channels).find((c) => c.kind === "facebook")!, Object.values(s.db.channels).find((c) => c.kind === "instagram")!];
  // giống removeChannel khi đã có hội thoại: tắt kênh, xóa token, giữ lịch sử
  for (const c of [fb, ig]) { s.db.channels[c.id].off = true; s.db.channels[c.id].sendEnabled = false; delete s.db.secrets![`static:${c.id}`]; }
  s.db.channels[fb.id].access = { lan: "send" };
  const r = await connectPages(s, await createPickSession(s, [page("1", { token: "MOI", ig: { id: "IG1" } })]), [{ pageId: "1", instagram: true }], subOk);
  assert.ok(r.ok && r.results.every((x) => x.ok && /nối lại kênh cũ/.test(x.note)));
  assert.equal(Object.values(s.db.channels).length, 2, "không đẻ thêm kênh");
  for (const c of [fb, ig]) {
    const now = s.db.channels[c.id];
    assert.equal(now.off, false);
    assert.equal(now.sendEnabled, false);
    assert.equal(await staticTokens(s).get(c.id), "MOI");
  }
  assert.deepEqual(s.db.channels[fb.id].access, { lan: "send" }, "giữ phân quyền cũ");
  assert.equal(s.db.channels[ig.id].meta?.pageId, "1");
});

test("chẩn đoán đăng nhập: quyền đã cấp/từ chối, Page đã chia sẻ so với Page Meta trả về; token không lọt vào kết quả", async () => {
  const { f, calls } = router([
    ["/me/permissions", () => ({ data: [{ permission: "pages_show_list", status: "granted" }, { permission: "pages_messaging", status: "granted" }, { permission: "business_management", status: "declined" }] })],
    ["/debug_token", () => ({ data: { granular_scopes: [{ scope: "pages_messaging", target_ids: ["1", "2", "3"] }, { scope: "pages_show_list", target_ids: ["1", "2"] }, { scope: "instagram_basic", target_ids: ["9"] }] } })],
  ]);
  const d = await diagnoseLogin({ ...cfg, configId: "C1", rerequest: true }, "USERTOK", ["1", "2"], f);
  assert.deepEqual(d.granted, ["pages_show_list", "pages_messaging"]);
  assert.deepEqual(d.declined, ["business_management"]);
  assert.deepEqual(d.sharedPageIds.sort(), ["1", "2", "3"]);
  assert.deepEqual(d.missing, ["3"]);
  assert.equal(d.returned, 2);
  assert.deepEqual([d.usedConfigId, d.rerequest], [true, true]);
  const line = diagLine(d);
  assert.match(line, /thiếu 1 \(3\)/);
  assert.ok(!JSON.stringify([d, line]).includes("USERTOK") && !JSON.stringify([d, line]).includes("SEC"));
  // token người dùng ở header, khóa ứng dụng ở header (không ở URL)
  // debug_token bắt buộc nhận input_token qua tham số (dạng Meta tài liệu); các lời gọi khác để token ở header
  assert.ok(calls.filter((c) => !c.url.includes("debug_token")).every((c) => !c.url.includes("USERTOK")));
  assert.ok(calls.every((c) => !c.url.includes("SEC")));
  const dbg = calls.find((c) => c.url.includes("debug_token"))!;
  assert.equal((dbg.init!.headers as Record<string, string>).authorization, "Bearer APP|SEC");
});

test("chẩn đoán đăng nhập: Meta lỗi hoặc không gọi được thì trả kết quả có ghi lỗi, không ném ngoại lệ", async () => {
  const bad = router([["/me/permissions", () => ({ error: { message: "token sai" } })], ["/debug_token", () => ({ error: { message: "không được" } })]]);
  const d = await diagnoseLogin(cfg, "T", ["1"], bad.f);
  assert.match(d.error ?? "", /me\/permissions: token sai.*debug_token: không được/);
  assert.deepEqual(d.missing, []);
  const boom = (async () => { throw new Error("mất mạng"); }) as unknown as typeof fetch;
  assert.match((await diagnoseLogin(cfg, "T", [], boom)).error ?? "", /mất mạng/);
});

test("phiên chọn Page mang theo chẩn đoán, hết hạn thì mất", async () => {
  const s = mem();
  const diag = { granted: ["pages_show_list"], declined: [], sharedPageIds: ["1"], returned: 1, missing: [], usedConfigId: false, rerequest: false };
  const id = await createPickSession(s, [page("1")], 1000, diag);
  assert.deepEqual(await readPickDiag(s, id, 2000), diag);
  assert.equal(await readPickDiag(s, id, 1000 + 16 * 60_000), null);
  assert.equal(await readPickDiag(s, "khong-co"), null);
  assert.equal(await readPickDiag(s, await createPickSession(s, [page("1")], 1000), 2000), null, "phiên cũ không có chẩn đoán");
});

test("bắt đầu đăng nhập: cờ rerequest đi theo state để lần ra sau này", async () => {
  const s = mem();
  const a = await beginMetaLogin(s, 1000, true), b = await beginMetaLogin(s, 1000);
  assert.equal((await consumeOAuth(s, a, "facebook", 2000))?.rerequest, true);
  assert.equal((await consumeOAuth(s, b, "facebook", 2000))?.rerequest, undefined);
});
