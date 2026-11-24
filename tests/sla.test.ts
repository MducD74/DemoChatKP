import test from "node:test";
import assert from "node:assert/strict";
import type { DB, Store } from "../src/core/store";
import type { Message, SlaCfg } from "../src/core/types";
import { cleanSla, episodes, waitState, workingMs, thresholdFor } from "../src/core/sla";
import { overview, statistics } from "../src/core/stats";
import { seedDemo, setChannelSla, updateConversation, listConversations } from "../src/core/service";
import { DEMO_STAFF } from "../src/core/staff";

const [ADMIN, LAN, HAI] = DEMO_STAFF;
const MIN = 60_000;
// Mốc thứ Hai 2026-11-23 00:00 giờ Việt Nam
const MON = Date.UTC(2026, 10, 22, 17, 0, 0);
const vn = (day: number, h: number, m = 0) => MON + day * 86_400_000 + (h * 60 + m) * MIN; // day 0 = thứ Hai
const WORK: SlaCfg["hours"] = { days: [1, 2, 3, 4, 5], start: "08:00", end: "17:00" };

const mem = () => {
  const s = { db: { channels: {}, contacts: {}, conversations: {}, messages: {} } as DB,
    async load() { return structuredClone(s.db); }, async save(d: DB) { s.db = d; } };
  return s as Store & { db: DB };
};
const msg = (id: string, direction: "in" | "out", at: number, senderUid?: string, internal = false): Message => ({
  id, companyId: "c", conversationId: "x", externalId: id, direction, text: id, attachments: [], at, senderUid, internal,
});

test("giờ làm việc: trong giờ, ngoài giờ, qua đêm, qua cuối tuần, không đặt giờ", () => {
  assert.equal(workingMs(vn(0, 9), vn(0, 10), WORK), 60 * MIN); // trong giờ
  assert.equal(workingMs(vn(0, 6), vn(0, 7), WORK), 0); // trước giờ làm
  assert.equal(workingMs(vn(0, 16), vn(1, 9), WORK), 120 * MIN); // 16-17 thứ Hai + 8-9 thứ Ba
  assert.equal(workingMs(vn(4, 16), vn(7, 9), WORK), 120 * MIN); // thứ Sáu chiều rồi thứ Hai sáng: bỏ qua cuối tuần
  assert.equal(workingMs(vn(5, 9), vn(5, 12), WORK), 0); // thứ Bảy
  assert.equal(workingMs(vn(0, 7), vn(0, 18), WORK), 9 * 60 * MIN); // cả ngày làm việc
  assert.equal(workingMs(vn(0, 22), vn(1, 3)), 5 * 60 * MIN); // không đặt giờ: tính cả thời gian thực
  assert.equal(workingMs(100, 50, WORK), 0);
});

test("kiểm cấu hình SLA: bắt buộc ngưỡng, kiểm giờ, ngưỡng bỏ lỡ, người lạ", () => {
  const agents = ["lan", "hai"];
  assert.equal(cleanSla({}, agents).ok, false);
  assert.equal(cleanSla({ firstResponseMin: 0 }, agents).ok, false);
  assert.equal(cleanSla(null, agents).ok, false);
  const ok = cleanSla({ firstResponseMin: 5 }, agents);
  assert.ok(ok.ok && ok.sla.firstResponseMin === 5 && !ok.sla.hours && !ok.sla.missedMin); // không tự thêm mặc định nào
  assert.equal(cleanSla({ firstResponseMin: 10, missedMin: 5 }, agents).ok, false);
  assert.equal(cleanSla({ firstResponseMin: 5, hours: { days: [], start: "08:00", end: "17:00" } }, agents).ok, false);
  assert.equal(cleanSla({ firstResponseMin: 5, hours: { days: [1], start: "17:00", end: "08:00" } }, agents).ok, false);
  assert.equal(cleanSla({ firstResponseMin: 5, hours: { days: [1], start: "8h", end: "17:00" } }, agents).ok, false);
  assert.equal(cleanSla({ firstResponseMin: 5, perUser: { ke_gian: 3 } }, agents).ok, false);
  const full = cleanSla({ firstResponseMin: 5, missedMin: 30, hours: { days: [5, 1, 1], start: "08:00", end: "21:00" }, perUser: { lan: 3 } }, agents);
  assert.ok(full.ok && full.sla.hours!.days.join() === "1,5" && full.sla.perUser!.lan === 3);
});

test("lượt chờ: phiên mới sau 4 giờ, lượt trả lời sau, bỏ qua ghi chú nội bộ, người gửi từ nơi khác tính cho người phụ trách", () => {
  const t0 = vn(0, 9);
  const eps = episodes([
    msg("a", "in", t0), msg("b", "in", t0 + MIN), // hai tin liền: một lượt
    msg("n", "out", t0 + 2 * MIN, "lan", true), // ghi chú nội bộ: không tính là trả lời
    msg("c", "out", t0 + 5 * MIN, "lan"), // trả lời sau 5 phút
    msg("d", "in", t0 + 10 * MIN), msg("e", "out", t0 + 12 * MIN), // lượt sau, tin gửi từ nơi khác
    msg("f", "in", t0 + 6 * 3600_000), // sau hơn 4 giờ: phiên mới, đang chờ
  ], { assigneeUid: "hai" });
  assert.equal(eps.length, 3);
  assert.deepEqual([eps[0].first, eps[0].by, eps[0].end! - eps[0].start], [true, "lan", 5 * MIN]);
  assert.deepEqual([eps[1].first, eps[1].by], [false, "hai"]); // không có senderUid: tính cho người phụ trách
  assert.deepEqual([eps[2].first, eps[2].end], [true, undefined]);
});

test("chưa cài SLA thì không đo: không có ngưỡng, không có trạng thái chờ", () => {
  assert.equal(thresholdFor({ sla: undefined }, "lan"), undefined);
  assert.equal(waitState({ sla: undefined }, "lan", vn(0, 9), vn(0, 12)), undefined);
});

test("ngưỡng và trạng thái chờ: riêng từng sale, sắp vượt ở 80%, vượt, tính theo giờ làm việc", () => {
  const ch = { sla: { firstResponseMin: 10, perUser: { lan: 5 }, hours: WORK } };
  assert.equal(thresholdFor(ch, "lan"), 5);
  assert.equal(thresholdFor(ch, "hai"), 10);
  assert.equal(thresholdFor(ch, undefined), 10);
  const t = vn(0, 9);
  assert.equal(waitState(ch, "hai", t, t + 7 * MIN)!.state, "ok");
  assert.equal(waitState(ch, "hai", t, t + 8 * MIN)!.state, "soon");
  assert.equal(waitState(ch, "hai", t, t + 11 * MIN)!.state, "breach");
  assert.equal(waitState(ch, "lan", t, t + 6 * MIN)!.state, "breach"); // ngưỡng riêng 5 phút
  // khách nhắn lúc 20:00, đến 08:06 sáng hôm sau mới chờ 6 giờ thật nhưng chỉ 6 phút làm việc
  const w = waitState(ch, "hai", vn(0, 20), vn(1, 8, 6))!;
  assert.equal(Math.round(w.waitMin), 6);
  assert.equal(w.state, "ok");
});

// Dữ liệu thống kê: hai kênh, SLA chỉ cài cho kênh Messenger
async function statSetup() {
  const s = mem();
  await seedDemo(s);
  const now = Date.now();
  // xóa tin mẫu, dựng lại tin có mốc rõ ràng
  s.db.messages = {};
  const conv = (id: string) => s.db.conversations[id];
  const add = (cid: string, i: string, dir: "in" | "out", at: number, by?: string) => {
    s.db.messages[`${cid}:${i}`] = { id: `${cid}:${i}`, companyId: "demo", conversationId: cid, externalId: i, direction: dir, text: i, attachments: [], at, senderUid: by };
    conv(cid).lastMessageAt = Math.max(conv(cid).lastMessageAt ?? 0, at);
    if (dir === "in") conv(cid).lastInboundAt = Math.max(conv(cid).lastInboundAt ?? 0, at);
  };
  const U1 = "demo-fb:conv:u1", U2 = "demo-fb:conv:u2";
  add(U1, "a", "in", now - 60 * MIN); add(U1, "b", "out", now - 57 * MIN, "lan"); // Lan trả lời sau 3 phút
  add(U2, "a", "in", now - 50 * MIN); add(U2, "b", "out", now - 30 * MIN, "hai"); // Hải trả lời sau 20 phút
  add("demo-ig:conv:u3", "a", "in", now - 40 * MIN); // chưa trả lời, kênh Instagram chưa cài SLA
  conv(U1).assignedAt = now - 58 * MIN; conv(U2).assignedAt = now - 45 * MIN;
  await setChannelSla(s, "demo-fb", { firstResponseMin: 10, missedMin: 60 }, ["lan", "hai"]);
  return { s, now };
}

test("thống kê SLA: đạt, không đạt, theo người, theo kênh; kênh chưa cài SLA không đo", async () => {
  const { s, now } = await statSetup();
  const st = await statistics(s, ADMIN, { from: now - 86_400_000, to: now }, now);
  const fb = st.byChannel.find((c) => c.id === "demo-fb")!, ig = st.byChannel.find((c) => c.id === "demo-ig")!;
  assert.equal(fb.sla.answered, 2);
  assert.equal(fb.sla.within, 1); // Lan đạt, Hải không (20 phút > 10)
  assert.equal(fb.sla.rate, 0.5);
  assert.equal(Math.round(fb.sla.avgFrtMin!), 12); // (3 + 20) / 2
  assert.equal(ig.sla.configured, false);
  assert.equal(ig.sla.rate, null);
  assert.equal(ig.unanswered, 1);
  const lan = st.byStaff.find((x) => x.uid === "lan")!, hai = st.byStaff.find((x) => x.uid === "hai")!;
  assert.equal(lan.sla.rate, 1);
  assert.equal(hai.sla.rate, 0);
  assert.equal(st.slaDetail.length, 2); // chỉ kênh đã cài SLA
  assert.equal(st.cards.slaAny, true);
  assert.equal(st.cards.avgClaimMin, 3.5); // Lan nhận khách sau 2 phút, Hải sau 5 phút
});

test("thống kê: ngưỡng riêng của sale ghi đè ngưỡng kênh; khách đang chờ quá ngưỡng tính không đạt và bỏ lỡ", async () => {
  const { s, now } = await statSetup();
  await setChannelSla(s, "demo-fb", { firstResponseMin: 10, missedMin: 15, perUser: { hai: 25 } }, ["lan", "hai"]);
  let st = await statistics(s, ADMIN, { from: now - 86_400_000, to: now }, now);
  assert.equal(st.byStaff.find((x) => x.uid === "hai")!.sla.rate, 1); // 20 phút <= 25 phút của Hải
  assert.equal(st.slaDetail.find((d) => d.uid === "hai")!.limitMin, 25);
  // thêm một khách đang chờ 30 phút ở kênh Messenger, giao cho Hải
  s.db.messages["demo-fb:conv:u4:z"] = { id: "z", companyId: "demo", conversationId: "demo-fb:conv:u4", externalId: "z", direction: "in", text: "z", attachments: [], at: now - 30 * MIN };
  Object.assign(s.db.conversations["demo-fb:conv:u4"], { status: "open", assigneeUid: "hai", lastMessageAt: now - 30 * MIN, lastInboundAt: now - 30 * MIN });
  st = await statistics(s, ADMIN, { from: now - 86_400_000, to: now }, now);
  const hai = st.byStaff.find((x) => x.uid === "hai")!;
  assert.equal(hai.sla.breached, 1); // 30 > 25
  assert.equal(hai.sla.missed, 1); // 30 > 15 phút bỏ lỡ
  assert.equal(st.cards.missed, 1);
  const ov = await overview(s, now);
  assert.equal(ov.totals.slaBreach, 1);
  assert.equal(ov.attention[0].id, "demo-fb:conv:u4"); // vượt SLA lên đầu
});

test("thống kê theo quyền: nhân viên chỉ thấy số của mình, không xem được kênh mình không có; lọc theo kỳ", async () => {
  const { s, now } = await statSetup();
  const lan = await statistics(s, LAN, { from: now - 86_400_000, to: now, staffUid: "hai" }, now); // cố xem Hải
  assert.equal(lan.scope, "self");
  assert.deepEqual(lan.byStaff.map((x) => x.uid), ["lan"]); // tham số staff bị bỏ qua
  assert.equal(lan.byChannel.find((c) => c.id === "demo-fb")!.sla.answered, 1);
  // Hải bị bỏ khỏi kênh Messenger: không còn thấy số của kênh đó
  s.db.channels["demo-fb"].access = { lan: "send" };
  const hai = await statistics(s, HAI, { from: now - 86_400_000, to: now }, now);
  assert.equal(hai.byChannel.find((c) => c.id === "demo-fb"), undefined);
  // ngoài kỳ thì không có gì
  const old = await statistics(s, ADMIN, { from: now - 10 * 86_400_000, to: now - 9 * 86_400_000 }, now);
  assert.equal(old.cards.conversations, 0);
  // lọc theo kênh
  const one = await statistics(s, ADMIN, { from: now - 86_400_000, to: now, channelId: "demo-ig" }, now);
  assert.deepEqual(one.byChannel.map((c) => c.id), ["demo-ig"]);
});

test("cài SLA: gỡ được, kiểm lỗi, danh sách hội thoại có trạng thái SLA khi đã cài", async () => {
  const { s, now } = await statSetup();
  assert.equal((await setChannelSla(s, "demo-fb", { firstResponseMin: -1 }, ["lan"])).ok, false);
  assert.equal((await setChannelSla(s, "khong-co", { firstResponseMin: 5 }, ["lan"])).ok, false);
  let list = await listConversations(s, { status: "all", actor: ADMIN });
  assert.equal(list.find((i) => i.id === "demo-ig:conv:u3")!.sla, undefined); // kênh Instagram chưa cài
  await setChannelSla(s, "demo-ig", { firstResponseMin: 20 }, ["lan", "hai"]);
  list = await listConversations(s, { status: "all", actor: ADMIN });
  assert.equal(list.find((i) => i.id === "demo-ig:conv:u3")!.sla!.state, "breach"); // chờ 40 > 20 phút
  assert.equal((await setChannelSla(s, "demo-ig", null, [])).ok, true);
  assert.equal(s.db.channels["demo-ig"].sla, undefined);
  void now;
});

test("nhận khách: ghi lại lúc nhận để đo thời gian nhận khách", async () => {
  const s = mem();
  await seedDemo(s);
  s.db.channels["demo-fb"].sendEnabled = true;
  const U3 = "demo-ig:conv:u3";
  assert.equal(s.db.conversations[U3].assignedAt, undefined);
  const before = Date.now();
  assert.equal((await updateConversation(s, U3, { assigneeUid: "lan" }, LAN)).ok, true);
  assert.ok(s.db.conversations[U3].assignedAt! >= before);
  await updateConversation(s, U3, { assigneeUid: null }, LAN);
  assert.equal(s.db.conversations[U3].assignedAt, undefined);
});
