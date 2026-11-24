import test from "node:test";
import assert from "node:assert/strict";
import type { DB, Store } from "../src/core/store";
import type { BotDraft } from "../src/core/chatbot";
import { NEED_HUMAN_WAIT_MIN, needHumanMap } from "../src/core/botqueue";
import { listConversations } from "../src/core/service";
import { overview } from "../src/core/stats";
import { DEMO_STAFF } from "../src/core/staff";

const [ADMIN, LAN, HAI] = DEMO_STAFF;
const T0 = 1_700_000_000_000;
const MIN = 60_000;

const mem = () => {
  const s = { db: { channels: {}, contacts: {}, conversations: {}, messages: {} } as DB,
    async load() { return structuredClone(s.db); }, async save(d: DB) { s.db = d; } };
  return s as Store & { db: DB };
};
// Một kênh Messenger chỉ Lan được vào, vài hội thoại với khách giả
const setup = () => {
  const s = mem();
  s.db.channels["c"] = { id: "c", companyId: "x", kind: "facebook", externalId: "P", name: "Fanpage", sendEnabled: true, access: { [LAN.uid]: "send" } };
  for (const k of ["a", "b", "c2"]) {
    s.db.contacts[`k-${k}`] = { id: `k-${k}`, companyId: "x", channelId: "c", externalId: k, name: `Khách ${k}` };
    s.db.conversations[`v-${k}`] = { id: `v-${k}`, companyId: "x", channelId: "c", contactId: `k-${k}`, status: "open", labels: [], lastInboundAt: T0, lastMessageAt: T0 };
    s.db.messages[`m-${k}`] = { id: `m-${k}`, companyId: "x", conversationId: `v-${k}`, externalId: `m-${k}`, direction: "in", text: "Cho em hỏi", attachments: [], at: T0 };
  }
  s.db.bot = { settings: { docs: [] }, bots: {}, drafts: {} };
  return s;
};
let n = 0;
const draft = (s: { db: DB }, conv: string, over: Partial<BotDraft> = {}) => {
  const id = `d${++n}`;
  s.db.bot!.drafts[id] = { id, conversationId: conv, channelId: "c", forInboundAt: T0, kind: "handoff", text: "", reason: "Khách đòi hoàn tiền", status: "handed", shadow: false, at: T0 + MIN, ...over };
  return id;
};
const out = (s: { db: DB }, conv: string, at: number, over: Partial<DB["messages"][string]> = {}) => {
  const id = `o${++n}`;
  s.db.messages[id] = { id, companyId: "x", conversationId: conv, externalId: id, direction: "out", text: "Dạ", attachments: [], at, ...over };
};

test("bot đã chuyển người thì vào hàng đợi, có lý do, quá 15 phút thì quá hạn", () => {
  const s = setup();
  draft(s, "v-a");
  const early = needHumanMap(s.db, T0 + 5 * MIN).get("v-a");
  assert.ok(early);
  assert.equal(early.reason, "Khách đòi hoàn tiền");
  assert.equal(early.overdue, false);
  assert.equal(early.auto, true);
  assert.equal(early.since, T0 + MIN);
  assert.equal(needHumanMap(s.db, T0 + MIN + NEED_HUMAN_WAIT_MIN * MIN).get("v-a")?.overdue, true);
  assert.equal(needHumanMap(s.db, T0 + 5 * MIN).has("v-b"), false, "hội thoại khác không bị tính");
});

test("bot chỉ đề nghị chuyển người (nháp đang chờ) cũng vào hàng đợi, đánh dấu không tự động", () => {
  const s = setup();
  draft(s, "v-a", { status: "pending", reason: undefined });
  const x = needHumanMap(s.db, T0 + 2 * MIN).get("v-a");
  assert.ok(x);
  assert.equal(x.auto, false);
  assert.equal(x.reason, "Chatbot đề nghị người xử lý");
});

test("người đã trả lời thì ra khỏi hàng đợi; tin của bot và ghi chú nội bộ thì không", () => {
  const s = setup();
  draft(s, "v-a");
  draft(s, "v-b");
  out(s, "v-a", T0 + 2 * MIN, { senderUid: LAN.uid }); // nhân viên trả lời
  out(s, "v-b", T0 + 2 * MIN, { bot: true }); // bot gửi câu báo chuyển người
  out(s, "v-b", T0 + 3 * MIN, { internal: true, senderUid: LAN.uid }); // ghi chú nội bộ
  const m = needHumanMap(s.db, T0 + 10 * MIN);
  assert.equal(m.has("v-a"), false);
  assert.equal(m.has("v-b"), true);
  // người trả lời trước lúc bot chuyển thì chưa tính
  const s2 = setup();
  out(s2, "v-a", T0 + 30_000, { senderUid: LAN.uid });
  draft(s2, "v-a");
  assert.equal(needHumanMap(s2.db, T0 + 10 * MIN).has("v-a"), true);
});

test("nhân viên tiếp quản (dừng bot) thì ra khỏi hàng đợi; tiếp quản từ trước lúc chuyển thì chưa tính", () => {
  const s = setup();
  draft(s, "v-a");
  s.db.conversations["v-a"].botCtl = { off: true, by: LAN.uid, at: T0 + 2 * MIN };
  draft(s, "v-b");
  s.db.conversations["v-b"].botCtl = { off: true, by: LAN.uid, at: T0 };
  const m = needHumanMap(s.db, T0 + 10 * MIN);
  assert.equal(m.has("v-a"), false);
  assert.equal(m.has("v-b"), true);
});

test("có người bấm Nhận hoặc được giao tay sau lúc bot chuyển thì ra khỏi hàng đợi; hệ thống tự chia hoặc giao từ trước thì chưa", () => {
  const s = setup();
  draft(s, "v-a");
  draft(s, "v-b");
  draft(s, "v-c2");
  Object.assign(s.db.conversations["v-a"], { assigneeUid: LAN.uid, assignedAt: T0 + 2 * MIN }); // nhân viên bấm Nhận
  Object.assign(s.db.conversations["v-b"], { assigneeUid: LAN.uid, assignedAt: T0 + 2 * MIN, autoAssigned: true }); // hệ thống tự chia
  Object.assign(s.db.conversations["v-c2"], { assigneeUid: LAN.uid, assignedAt: T0 }); // đã giao từ trước lúc bot chuyển
  const m = needHumanMap(s.db, T0 + 10 * MIN);
  assert.equal(m.has("v-a"), false);
  assert.equal(m.has("v-b"), true);
  assert.equal(m.has("v-c2"), true);
});

test("hội thoại đã xong, nháp bị bỏ hoặc cũ, hoặc nháp mới nhất là câu trả lời thì không ở hàng đợi", () => {
  const s = setup();
  draft(s, "v-a");
  s.db.conversations["v-a"].status = "resolved";
  draft(s, "v-b", { status: "stale" });
  draft(s, "v-b", { status: "discarded", at: T0 + 2 * MIN });
  draft(s, "v-c2");
  draft(s, "v-c2", { kind: "reply", status: "auto", text: "Dạ", reason: undefined, at: T0 + 3 * MIN }); // bot đã trả lời tiếp sau đó
  const m = needHumanMap(s.db, T0 + 10 * MIN);
  assert.equal(m.size, 0);
});

test("danh sách hội thoại: cần người lên đầu, chờ lâu nhất trước; chỉ người được xem hội thoại mới thấy", async () => {
  const s = setup();
  s.db.conversations["v-a"].lastMessageAt = T0 + 50 * MIN; // mới nhất, nhưng không cần người
  draft(s, "v-b", { at: Date.now() - 30 * MIN });
  draft(s, "v-c2", { at: Date.now() - 60 * MIN, reason: "Khách xin gặp người thật" });
  const lan = await listConversations(s, { actor: LAN, assignee: "all" });
  assert.deepEqual(lan.map((i) => i.id), ["v-c2", "v-b", "v-a"], "chờ lâu nhất đứng đầu");
  assert.equal(lan[0].needHuman?.reason, "Khách xin gặp người thật");
  assert.equal(lan[0].needHuman?.overdue, true);
  assert.equal(lan[2].needHuman, undefined);
  const hai = await listConversations(s, { actor: HAI, assignee: "all" });
  assert.equal(hai.length, 0, "nhân viên không có quyền ở kênh thì không thấy gì, kể cả hàng đợi");
  const admin = await listConversations(s, { actor: ADMIN, assignee: "all" });
  assert.equal(admin.filter((i) => i.needHuman).length, 2);
});

test("Tổng quan: cảnh báo đỏ khi có hội thoại cần người quá 15 phút, cảnh báo vàng khi còn trong hạn", async () => {
  const now = Date.now();
  const s = setup();
  draft(s, "v-a", { at: now - 30 * MIN });
  draft(s, "v-b", { at: now - 2 * MIN });
  const o = await overview(s, now);
  assert.ok(o.alerts.some((a) => a.level === "bad" && /1 hội thoại chatbot đã chuyển người, chờ quá 15 phút/.test(a.text)), JSON.stringify(o.alerts));
  assert.ok(o.alerts.some((a) => a.level === "warn" && /1 hội thoại chatbot đã chuyển người, đang chờ/.test(a.text)), JSON.stringify(o.alerts));
  const s2 = setup();
  const o2 = await overview(s2, now);
  assert.ok(!o2.alerts.some((a) => /bot đã chuyển người/.test(a.text)));
});

test("botqueue.ts chỉ đọc: không import send hay service, không đổi dữ liệu", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/core/botqueue.ts", import.meta.url), "utf8");
  assert.ok(!/from "\.\/(send|service)"/.test(src.replace(/import type[^\n]*\n/g, "")));
  assert.ok(!/import \{[^}]*mutate[^}]*\} from "\.\/store"/.test(src)); // chỉ dùng chỉ mục đọc của kho (messagesOf), không ghi
  assert.ok(!/sendMessage|sendReply|mutate\(|\.save\(/.test(src));
  const s = setup();
  draft(s, "v-a");
  const before = JSON.stringify(s.db);
  needHumanMap(s.db, T0 + 20 * MIN);
  assert.equal(JSON.stringify(s.db), before);
});

test("Tổng quan có ô số liệu bot: số chờ người, quá hạn, tin bot đã trả lời hôm nay; chưa dùng bot thì không hiện", async () => {
  const s = setup();
  assert.equal((await overview(s, T0 + 5 * MIN)).bot.used, false);
  draft(s, "v-a");
  out(s, "v-b", T0 + 2 * MIN, { bot: true });
  out(s, "v-b", T0 - 3 * 86400_000, { bot: true }); // bot trả lời từ mấy ngày trước: không tính hôm nay
  const o = await overview(s, T0 + 5 * MIN);
  assert.equal(o.bot.used, true);
  assert.equal(o.bot.need, 1);
  assert.equal(o.bot.needLate, 0);
  assert.equal(o.bot.repliesToday, 1);
  assert.equal((await overview(s, T0 + 30 * MIN)).bot.needLate, 1);
});

test("danh sách hội thoại cho biết khách đã có số điện thoại chưa (để lọc Chỉ khách có số)", async () => {
  const s = setup();
  s.db.contacts["k-a"].phone = "0901234567";
  const items = await listConversations(s, { actor: ADMIN, status: "all" });
  assert.equal(items.find((i) => i.id === "v-a")?.hasPhone, true);
  assert.equal(items.find((i) => i.id === "v-b")?.hasPhone, false);
});
