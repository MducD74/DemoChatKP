import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  beginOAuth, channelViews, consumeOAuth, createChannel, pkceChallenge, removeChannel,
  subscribeMetaPage, subscribeTikTokWebhook, tiktokAuthUrl, verifyMetaToken, zaloAuthUrl,
} from "../src/core/connect";
import { staticTokens, storeBackedTokens } from "../src/core/token-store";
import type { DB, Store } from "../src/core/store";

const mem = () => {
  const s = { db: { channels: {}, contacts: {}, conversations: {}, messages: {} } as DB,
    async load() { return structuredClone(s.db); }, async save(d: DB) { s.db = d; } };
  return s as Store & { db: DB };
};
const fakeFetch = (reply: unknown, status = 200) => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const f = (async (url: string, init?: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify(reply), { status }); }) as unknown as typeof fetch;
  return { f, calls };
};

test("tạo kênh: kiểm dữ liệu, gửi tin mặc định tắt, chống trùng, Instagram cần Page ID", async () => {
  const s = mem();
  assert.equal((await createChannel(s, { kind: "facebook", name: "A" })).ok, false);
  assert.equal((await createChannel(s, { kind: "instagram", name: "I", externalId: "IG1" })).ok, false);
  const fb = await createChannel(s, { kind: "facebook", name: "Fan", externalId: "P1" });
  assert.ok(fb.ok && fb.channel.sendEnabled === false);
  assert.equal((await createChannel(s, { kind: "facebook", name: "Fan 2", externalId: "P1" })).ok, false);
  const ig = await createChannel(s, { kind: "instagram", name: "I", externalId: "IG1", pageId: "P1" });
  assert.ok(ig.ok && ig.channel.meta?.pageId === "P1");
  const zalo = await createChannel(s, { kind: "zalo_oa", name: "OA" });
  assert.ok(zalo.ok && zalo.channel.externalId === "");
  assert.equal((await createChannel(s, { kind: "zalo_personal" as never, name: "x" })).ok, false);
});

test("trạng thái kênh: Meta theo token tĩnh, Zalo theo cặp token và hạn", async () => {
  const s = mem();
  const fb = await createChannel(s, { kind: "facebook", name: "Fan", externalId: "P1" });
  const z = await createChannel(s, { kind: "zalo_oa", name: "OA" });
  if (!fb.ok || !z.ok) throw new Error("tạo lỗi");
  const status = async (id: string, now?: number) => (await channelViews(s, now)).find((v) => v.id === id)!.status;
  assert.equal(await status(fb.channel.id), "no_token");
  await staticTokens(s).save(fb.channel.id, "PAGE-TOKEN");
  assert.equal(await status(fb.channel.id), "connected");
  assert.ok(!JSON.stringify(s.db).includes("PAGE-TOKEN")); // lưu mã hóa
  assert.equal(await status(z.channel.id), "pending");
  s.db.channels[z.channel.id].externalId = "OA9";
  await storeBackedTokens(s).save(z.channel.id, { accessToken: "a", refreshToken: "r", accessExpiresAt: 1, refreshExpiresAt: 1000 });
  assert.equal(await status(z.channel.id, 500), "connected");
  assert.equal(await status(z.channel.id, 2000), "expired");
});

test("gỡ kênh: có hội thoại thì giữ lịch sử và xóa token; không thì xóa hẳn", async () => {
  const s = mem();
  const a = await createChannel(s, { kind: "facebook", name: "A", externalId: "P1" });
  const b = await createChannel(s, { kind: "facebook", name: "B", externalId: "P2" });
  if (!a.ok || !b.ok) throw new Error("tạo lỗi");
  await staticTokens(s).save(a.channel.id, "T");
  s.db.conversations["c"] = { id: "c", companyId: "x", channelId: a.channel.id, contactId: "k", status: "open", labels: [] };
  a.channel.sendEnabled = true; s.db.channels[a.channel.id].sendEnabled = true;
  assert.equal(await removeChannel(s, a.channel.id), "disconnected");
  assert.equal(s.db.channels[a.channel.id].off, true);
  assert.equal(s.db.channels[a.channel.id].sendEnabled, false);
  assert.equal(await staticTokens(s).get(a.channel.id), null);
  assert.equal(await removeChannel(s, b.channel.id), "removed");
  assert.equal(s.db.channels[b.channel.id], undefined);
  assert.equal(await removeChannel(s, "khong-co"), null);
});

test("OAuth: state dùng một lần, hết hạn sau 15 phút, sai loại kênh bị từ chối; PKCE đúng", async () => {
  const s = mem();
  const z = await createChannel(s, { kind: "zalo_oa", name: "OA" });
  if (!z.ok) throw new Error();
  const b = (await beginOAuth(s, z.channel.id, "zalo_oa", true, 1000))!;
  assert.ok(b.challenge && b.state.length === 32);
  const st = await consumeOAuth(s, b.state, "zalo_oa", 2000);
  assert.equal(st?.channelId, z.channel.id);
  assert.equal(st?.verifier?.length, 43);
  assert.equal(pkceChallenge(st!.verifier!), b.challenge);
  assert.equal(b.challenge, createHash("sha256").update(st!.verifier!).digest("base64url"));
  assert.equal(await consumeOAuth(s, b.state, "zalo_oa", 2000), null); // đã dùng
  const b2 = (await beginOAuth(s, z.channel.id, "zalo_oa", true, 1000))!;
  assert.equal(await consumeOAuth(s, b2.state, "zalo_oa", 1000 + 16 * 60_000), null); // hết hạn
  const b3 = (await beginOAuth(s, z.channel.id, "zalo_oa", true, 1000))!;
  assert.equal(await consumeOAuth(s, b3.state, "tiktok", 1500), null); // sai loại
  assert.equal(await beginOAuth(s, "khong-co", "zalo_oa", true), null);
  assert.equal(await beginOAuth(s, z.channel.id, "tiktok", false), null);
  assert.ok(!JSON.stringify(s.db.secrets).includes(st!.verifier!)); // verifier không lưu rõ
});

test("URL cấp quyền: Zalo có code_challenge và state; TikTok giữ tham số portal và thêm state", () => {
  const u = new URL(zaloAuthUrl("APP", "https://x/cb", "CH", "ST"));
  assert.equal(u.searchParams.get("app_id"), "APP");
  assert.equal(u.searchParams.get("redirect_uri"), "https://x/cb");
  assert.equal(u.searchParams.get("code_challenge"), "CH");
  assert.equal(u.searchParams.get("state"), "ST");
  const t = new URL(tiktokAuthUrl("https://www.tiktok.com/v2/auth/authorize?client_key=K&scope=a", "S1"));
  assert.equal(t.searchParams.get("client_key"), "K");
  assert.equal(t.searchParams.get("state"), "S1");
});

test("Meta: kiểm token (đúng Page, sai Page, bị từ chối) và đăng ký nhận tin", async () => {
  const ok = fakeFetch({ id: "P1", name: "Fan" });
  assert.deepEqual(await verifyMetaToken("T", "P1", ok.f), { ok: true, name: "Fan" });
  assert.equal((ok.calls[0].init!.headers as Record<string, string>).authorization, "Bearer T");
  assert.ok(!ok.calls[0].url.includes("T&") && !ok.calls[0].url.includes("access_token"));
  assert.equal((await verifyMetaToken("T", "P2", ok.f)).ok, false);
  assert.equal((await verifyMetaToken("T", "P1", fakeFetch({ error: { message: "bad" } }, 400).f)).ok, false);
  const sub = fakeFetch({ success: true });
  assert.equal((await subscribeMetaPage("P1", "T", sub.f)).ok, true);
  assert.match(sub.calls[0].url, /\/P1\/subscribed_apps\?subscribed_fields=messages$/);
  assert.equal((await subscribeMetaPage("P1", "T", fakeFetch({ error: { message: "no" } }, 400).f)).ok, false);
});

test("TikTok: đăng ký webhook cấp ứng dụng với DIRECT_MESSAGE", async () => {
  const f = fakeFetch({ code: 0, message: "OK" });
  assert.equal((await subscribeTikTokWebhook({ clientKey: "K", clientSecret: "S", callbackUrl: "https://x/api/webhook/tiktok" }, f.f)).ok, true);
  assert.deepEqual(JSON.parse(f.calls[0].init!.body as string), { app_id: "K", secret: "S", event_type: "DIRECT_MESSAGE", callback_url: "https://x/api/webhook/tiktok" });
  const bad = await subscribeTikTokWebhook({ clientKey: "K", clientSecret: "S", callbackUrl: "u" }, fakeFetch({ code: 40001, message: "bad" }).f);
  assert.equal(bad.ok, false);
});

test("token dán tay: có khóa ứng dụng thì kiểm bằng debug_token (không đòi pages_read_engagement), kiểm đúng Page", async () => {
  const f = (async (url: string) => {
    const t = new URL(url).searchParams.get("input_token");
    const data = t === "HONG" ? { is_valid: false } : { is_valid: true, profile_id: "P1" };
    return new Response(JSON.stringify({ data }), { status: 200 });
  }) as unknown as typeof fetch;
  const app = { appId: "APP", appSecret: "S" };
  assert.deepEqual(await verifyMetaToken("T", "P1", f, app), { ok: true });
  assert.match((await verifyMetaToken("T", "P2", f, app) as { error: string }).error, /không khớp/);
  assert.equal((await verifyMetaToken("HONG", "P1", f, app)).ok, false);
});
