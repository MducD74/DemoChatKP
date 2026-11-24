import test from "node:test";
import assert from "node:assert/strict";
import { importHistory } from "../src/core/history";
import { ingest, onInbound } from "../src/core/ingest";
import { listConversations } from "../src/core/service";
import { markWebhook, probeWebhook, webhookSeen } from "../src/core/webhookstate";
import type { DB, Store } from "../src/core/store";
import type { Channel, InboundEvent } from "../src/core/types";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-11-22T12:00:00Z");
const iso = (hoursAgo: number) => new Date(NOW - hoursAgo * HOUR).toISOString();
const ch: Channel = { id: "c1", companyId: "co", kind: "facebook", externalId: "PAGE1", name: "T", sendEnabled: true };
const memStore = (): Store & { db: DB } => {
  const s = { db: { channels: { c1: { ...ch } }, contacts: {}, conversations: {}, messages: {} } as DB,
    async load() { return structuredClone(s.db); }, async save(d: DB) { s.db = d; } };
  return s;
};
const graph = (routes: Record<string, unknown>) => (async (url: string) => {
  const key = Object.keys(routes).find((k) => url.includes(k));
  return new Response(JSON.stringify(key ? routes[key] : { error: { message: "no route", code: 100 } }), { status: key ? 200 : 404 });
}) as unknown as typeof fetch;
const conv = (id: string, hoursAgo: number) => ({ id, updated_time: iso(hoursAgo), participants: { data: [{ id: "U" + id, name: "Khách " + id }, { id: "PAGE1" }] } });
const msg = (id: string, hoursAgo: number, from: string, message = "xin chào") => ({ id, created_time: iso(hoursAgo), from: { id: from }, message });
const run = (s: Store & { db: DB }, f: typeof fetch, extra: object) => importHistory(s, s.db.channels.c1, { days: 0, getToken: async () => "TOK", fetchImpl: f, now: NOW, ...extra } as never);
const actor = { uid: "admin", role: "admin" as const, name: "Q" };

test("khôi phục tin lỡ: ghi như tin mới (mở hội thoại, báo chưa đọc, không đánh dấu lịch sử)", async () => {
  const s = memStore();
  const f = graph({
    "/PAGE1/conversations": { data: [conv("t1", 2)] },
    "/t1/messages": { data: [msg("m_b", 1, "PAGE1", "dạ shop đây"), msg("m_a", 2, "Ut1", "khách hỏi giá")] },
  });
  const job = await run(s, f, { mode: "catchup", hours: 6 });
  assert.equal(job.status, "done");
  assert.equal(job.stored, 2);
  const c = s.db.conversations["c1:conv:Ut1"];
  assert.equal(c.status, "open");
  assert.equal(c.lastInboundHistory, undefined);
  assert.ok(Object.values(s.db.messages).every((m) => !m.history));
  const [item] = await listConversations(s, { actor, status: "all" });
  assert.equal(item.unread, true);
});

test("khôi phục tin lỡ: chỉ lấy trong số giờ yêu cầu và không đánh thức chatbot", async () => {
  const s = memStore();
  const f = graph({
    "/PAGE1/conversations": { data: [conv("t1", 1), conv("t2", 30)] },
    "/t1/messages": { data: [msg("m_new", 1, "Ut1", "mới"), msg("m_old", 10, "Ut1", "cũ hơn 6 giờ")] },
  });
  const called: string[][] = [];
  onInbound("catchup-test", (_s, ids) => called.push(ids));
  const job = await run(s, f, { mode: "catchup", hours: 6 });
  assert.equal(job.stored, 1); // tin 10 giờ trước và hội thoại 30 giờ trước bị bỏ
  assert.equal(Object.values(s.db.messages)[0].text, "mới");
  assert.equal(called.length, 0); // khôi phục không kích hoạt bot
  // tin đến trực tiếp thì có kích hoạt (đối chứng)
  const live: InboundEvent[] = [{ channelExternalId: "PAGE1", contact: { externalId: "Ux" }, message: { externalId: "m_live", direction: "in", text: "alo", attachments: [], at: NOW } }];
  await ingest(s, "facebook", live);
  assert.equal(called.length, 1);
});

test("khôi phục: mở lại hội thoại đã xong khi có tin khách lỡ, chạy lại không trùng", async () => {
  const s = memStore();
  const routes = { "/PAGE1/conversations": { data: [conv("t1", 3)] }, "/t1/messages": { data: [msg("m_old", 3, "Ut1", "tin cũ")] } };
  await run(s, graph(routes), { mode: "history", days: 30 });
  assert.equal(s.db.conversations["c1:conv:Ut1"].status, "resolved");
  const routes2 = { "/PAGE1/conversations": { data: [conv("t1", 1)] }, "/t1/messages": { data: [msg("m_lo", 1, "Ut1", "tin lỡ"), msg("m_old", 3, "Ut1", "tin cũ")] } };
  const a = await run(s, graph(routes2), { mode: "catchup", hours: 6 });
  assert.equal(a.stored, 1);
  assert.equal(a.duplicates, 1);
  assert.equal(s.db.conversations["c1:conv:Ut1"].status, "open"); // có tin khách mới lỡ nên mở lại
  const b = await run(s, graph(routes2), { mode: "catchup", hours: 6 });
  assert.equal(b.stored, 0);
});

test("khôi phục bắt buộc có khoảng thời gian (tránh nạp cả lịch sử như tin mới)", async () => {
  const s = memStore();
  const job = await run(s, graph({}), { mode: "catchup" });
  assert.equal(job.status, "error");
  assert.match(job.error!, /khoảng thời gian/);
  assert.equal(Object.keys(s.db.messages).length, 0);
});

test("kiểm tra webhook công khai: truy cập được, sai nội dung, mã lỗi, quá thời gian, chưa cấu hình", async () => {
  const env = { KPCHAT_PUBLIC_URL: "https://x.example/", META_VERIFY_TOKEN: "V" };
  const echo = (async (url: string) => new Response(new URL(url).searchParams.get("hub.challenge"), { status: 200 })) as unknown as typeof fetch;
  assert.deepEqual(await probeWebhook(env, echo), { configured: true, reachable: true, url: "https://x.example" });
  const other = (async () => new Response("<html>trang khác</html>", { status: 200 })) as unknown as typeof fetch;
  const r1 = await probeWebhook(env, other);
  assert.equal(r1.reachable, false);
  assert.match(r1.detail!, /không phải KP Chat/);
  const err530 = (async () => new Response("", { status: 530 })) as unknown as typeof fetch;
  assert.match((await probeWebhook(env, err530)).detail!, /530/);
  const boom = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
  assert.equal((await probeWebhook(env, boom)).reachable, false);
  const slow = (async (_u: string, init: RequestInit) => new Promise<Response>((_r, rej) => init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("t"), { name: "TimeoutError" }))))) as unknown as typeof fetch;
  assert.match((await probeWebhook(env, slow, 30)).detail!, /Quá thời gian/);
  assert.deepEqual(await probeWebhook({ META_VERIFY_TOKEN: "V" }), { configured: false });
  assert.deepEqual(await probeWebhook({ KPCHAT_PUBLIC_URL: "https://x" }), { configured: false });
});

test("ghi nhận lần cuối nhận tin qua webhook", () => {
  markWebhook("facebook", 123);
  assert.equal(webhookSeen().facebook, 123);
});
