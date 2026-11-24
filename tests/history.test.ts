import test from "node:test";
import assert from "node:assert/strict";
import { cancelHistory, getHistoryJob, importHistory } from "../src/core/history";
import { ingest } from "../src/core/ingest";
import { listConversations, unreadCount } from "../src/core/service";
import { episodes } from "../src/core/sla";
import { statistics } from "../src/core/stats";
import type { DB, Store } from "../src/core/store";
import type { Channel, InboundEvent } from "../src/core/types";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-22T00:00:00Z");
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

const mkChannel = (over: Partial<Channel> = {}): Channel => ({ id: "c1", companyId: "co", kind: "facebook", externalId: "PAGE1", name: "T", sendEnabled: false, ...over });
const memStore = (ch = mkChannel()): Store & { db: DB } => {
  const s = { db: { channels: { [ch.id]: ch }, contacts: {}, conversations: {}, messages: {} } as DB,
    async load() { return structuredClone(s.db); }, async save(d: DB) { s.db = d; } };
  return s;
};

type Reply = { status?: number; body: unknown };
// Graph giả: khớp theo đường dẫn; ghi lại các địa chỉ đã gọi
function graph(routes: Record<string, Reply | Reply[]>) {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    const r = key ? routes[key] : { status: 404, body: { error: { message: "no route", code: 100 } } };
    const reply = Array.isArray(r) ? r.shift()! : r;
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const run = (s: Store, ch: Channel, f: typeof fetch, days = 30, extra: object = {}) =>
  importHistory(s, ch, { days, getToken: async () => "TOK", fetchImpl: f, now: NOW, ...extra });

const conv = (id: string, daysAgo: number, user = "U" + id) => ({ id, updated_time: iso(daysAgo), participants: { data: [{ id: user, name: "Khách " + id }, { id: "PAGE1", name: "Page" }] } });
const msg = (id: string, daysAgo: number, from: string, message = "xin chào") => ({ id, created_time: iso(daysAgo), from: { id: from }, message });

test("tải tin cũ: đúng chiều, tên khách, hội thoại ở trạng thái đã xong, không chia khách", async () => {
  const s = memStore();
  const { f } = graph({
    "/PAGE1/conversations": { body: { data: [conv("t1", 2)] } },
    "/t1/messages": { body: { data: [msg("m_b", 2, "PAGE1", "dạ shop đây"), msg("m_a", 3, "Ut1", "còn hàng không")] } }, // mới nhất trước
  });
  const job = await run(s, s.db.channels.c1, f);
  assert.equal(job.status, "done");
  assert.equal(job.stored, 2);
  const c = s.db.conversations["c1:conv:Ut1"];
  assert.equal(c.status, "resolved");
  assert.equal(c.assigneeUid, undefined);
  assert.equal(s.db.contacts["c1:Ut1"].name, "Khách t1");
  const m = Object.values(s.db.messages).sort((a, b) => a.at - b.at);
  assert.deepEqual(m.map((x) => [x.direction, x.text, x.history]), [["in", "còn hàng không", true], ["out", "dạ shop đây", true]]);
});

test("chạy lại không bị trùng, tin cũ không tính chưa đọc, SLA và thống kê", async () => {
  const s = memStore();
  const routes = () => ({
    "/PAGE1/conversations": { body: { data: [conv("t1", 2)] } },
    "/t1/messages": { body: { data: [msg("m_a", 2, "Ut1", "khách hỏi, chưa ai trả lời")] } },
  });
  await run(s, s.db.channels.c1, graph(routes()).f);
  const again = await run(s, s.db.channels.c1, graph(routes()).f);
  assert.equal(again.stored, 0);
  assert.equal(again.duplicates, 1);
  const actor = { uid: "admin", role: "admin" as const, name: "Q" };
  assert.equal(await unreadCount(s, actor), 0);
  const [item] = await listConversations(s, { actor, status: "all" });
  assert.equal(item.unread, false);
  assert.deepEqual(episodes(Object.values(s.db.messages), {}), []);
  const st = await statistics(s, actor, { from: NOW - 30 * DAY, to: NOW }, NOW);
  assert.equal(JSON.stringify(st).includes("khách hỏi"), false);
});

test("khách nhắn mới sau khi tải: mở lại hội thoại và báo chưa đọc", async () => {
  const s = memStore();
  await run(s, s.db.channels.c1, graph({
    "/PAGE1/conversations": { body: { data: [conv("t1", 5)] } },
    "/t1/messages": { body: { data: [msg("m_a", 5, "Ut1")] } },
  }).f);
  const live: InboundEvent[] = [{ channelExternalId: "PAGE1", contact: { externalId: "Ut1" }, message: { externalId: "m_live", direction: "in", text: "alo", attachments: [], at: NOW } }];
  await ingest(s, "facebook", live);
  const c = s.db.conversations["c1:conv:Ut1"];
  assert.equal(c.status, "open");
  assert.equal(c.lastInboundHistory, undefined);
  assert.equal(s.db.messages["c1:m_live"].history, undefined);
});

test("mốc ngày: bỏ hội thoại và tin cũ hơn mốc, dừng khi cả trang đều cũ", async () => {
  const s = memStore();
  const { f, calls } = graph({
    "after=NEXT": { body: { data: [conv("t3", 90)], paging: { next: "https://graph.facebook.com/v27.0/PAGE1/conversations?after=NEXT2" } } },
    "/PAGE1/conversations": { body: { data: [conv("t1", 5), conv("t2", 60)], paging: { next: "https://graph.facebook.com/v27.0/PAGE1/conversations?after=NEXT" } } },
    "/t1/messages": { body: { data: [msg("m_new", 5, "Ut1", "mới"), msg("m_old", 45, "Ut1", "cũ quá")], paging: { next: "https://x/t1/messages?after=P2" } } },
  });
  const job = await run(s, s.db.channels.c1, f, 30);
  assert.equal(job.stored, 1);
  assert.equal(Object.values(s.db.messages)[0].text, "mới");
  assert.equal(job.conversations, 1);
  assert.equal(calls.some((u) => u.includes("t2/messages")), false);
  assert.equal(calls.some((u) => u.includes("t3/messages") || u.includes("after=NEXT2")), false); // trang toàn hội thoại cũ: dừng hẳn
  assert.equal(calls.some((u) => u.includes("after=P2")), false); // gặp tin cũ hơn mốc thì không lật trang tiếp
});

test("toàn bộ (0 ngày): đi hết các trang hội thoại và tin", async () => {
  const s = memStore();
  const { f } = graph({
    "after=NEXT": { body: { data: [conv("t2", 90)] } },
    "/PAGE1/conversations": { body: { data: [conv("t1", 1)], paging: { next: "https://graph.facebook.com/v27.0/PAGE1/conversations?after=NEXT" } } },
    "after=P2": { body: { data: [msg("m_2", 3, "Ut1", "trang hai")] } },
    "/t1/messages": { body: { data: [msg("m_1", 1, "Ut1", "trang một")], paging: { next: "https://x/t1/messages?after=P2" } } },
    "/t2/messages": { body: { data: [msg("m_3", 90, "Ut2", "rất cũ")] } },
  });
  const job = await run(s, s.db.channels.c1, f, 0);
  assert.equal(job.stored, 3);
  assert.equal(job.conversations, 2);
});

test("ảnh, video, tệp, sticker; bỏ tin không chữ không đính kèm", async () => {
  const s = memStore();
  await run(s, s.db.channels.c1, graph({
    "/PAGE1/conversations": { body: { data: [conv("t1", 1)] } },
    "/t1/messages": { body: { data: [
      { id: "m_1", created_time: iso(1), from: { id: "Ut1" }, attachments: { data: [{ image_data: { url: "https://i/1.jpg" } }, { video_data: { url: "https://v/1.mp4" } }, { file_url: "https://f/a.pdf", mime_type: "application/pdf", name: "a.pdf" }] } },
      { id: "m_2", created_time: iso(1), from: { id: "Ut1" }, sticker: "https://s/1.png" },
      { id: "m_3", created_time: iso(1), from: { id: "Ut1" } },
    ] } },
  }).f);
  assert.deepEqual(s.db.messages["c1:m_1"].attachments.map((a) => a.type), ["image", "video", "file"]);
  assert.equal(s.db.messages["c1:m_2"].attachments[0].type, "image");
  assert.equal(s.db.messages["c1:m_3"], undefined);
});

test("Instagram: gọi bằng mã Page với platform=instagram", async () => {
  const ch = mkChannel({ id: "ig1", kind: "instagram", externalId: "IG9", meta: { pageId: "PAGE7" } });
  const s = memStore(ch);
  const { f, calls } = graph({
    "/PAGE7/conversations": { body: { data: [{ id: "t1", updated_time: iso(1), participants: { data: [{ id: "IGU", username: "lan.studio" }, { id: "IG9" }] } }] } },
    "/t1/messages": { body: { data: [{ id: "m_1", created_time: iso(1), from: { id: "IGU" }, message: "hi" }] } },
  });
  const job = await run(s, ch, f);
  assert.equal(job.stored, 1);
  assert.match(calls[0], /PAGE7\/conversations\?.*platform=instagram/);
  assert.equal(s.db.contacts["ig1:IGU"].name, "lan.studio");
});

test("lỗi: giới hạn tốc độ, token hết hạn, thiếu quyền, thiếu token; giữ tin đã tải", async () => {
  const s = memStore();
  let r = await run(s, s.db.channels.c1, graph({ "/PAGE1/conversations": { status: 400, body: { error: { code: 613, message: "x" } } } }).f);
  assert.equal(r.status, "error");
  assert.match(r.error!, /giới hạn/);
  r = await run(s, s.db.channels.c1, graph({ "/PAGE1/conversations": { status: 400, body: { error: { code: 190, message: "x" } } } }).f);
  assert.match(r.error!, /hết hạn/);
  r = await run(s, s.db.channels.c1, graph({ "/PAGE1/conversations": { status: 403, body: { error: { code: 200, message: "x" } } } }).f);
  assert.match(r.error!, /pages_messaging/);
  r = await importHistory(s, s.db.channels.c1, { days: 30, getToken: async () => null, now: NOW });
  assert.match(r.error!, /token/);
  // lỗi giữa chừng: tin của hội thoại trước vẫn được giữ
  const s2 = memStore();
  r = await run(s2, s2.db.channels.c1, graph({
    "/PAGE1/conversations": { body: { data: [conv("t1", 1), conv("t2", 1)] } },
    "/t1/messages": { body: { data: [msg("m_1", 1, "Ut1")] } },
    "/t2/messages": { status: 400, body: { error: { code: 613, message: "x" } } },
  }).f);
  assert.equal(r.status, "error");
  assert.equal(r.stored, 1);
  assert.equal(Object.keys(s2.db.messages).length, 1);
});

test("dừng giữa chừng và không chạy hai lần cùng lúc", async () => {
  const s = memStore();
  let release!: () => void;
  const gate = new Promise<void>((res) => { release = res; });
  const slow = (async (url: string) => {
    if (url.includes("/PAGE1/conversations")) { await gate; return new Response(JSON.stringify({ data: [conv("t1", 1), conv("t2", 1)] }), { status: 200 }); }
    return new Response(JSON.stringify({ data: [msg("m_" + url.slice(-8), 1, "Ut1")] }), { status: 200 });
  }) as unknown as typeof fetch;
  const p = run(s, s.db.channels.c1, slow);
  assert.equal(getHistoryJob("c1")!.status, "running");
  const dup = await run(s, s.db.channels.c1, slow); // đang chạy: trả lại đợt hiện tại
  assert.equal(dup, getHistoryJob("c1"));
  assert.equal(cancelHistory("c1"), true);
  release();
  const job = await p;
  assert.equal(job.status, "stopped");
  assert.equal(job.conversations, 0);
});
