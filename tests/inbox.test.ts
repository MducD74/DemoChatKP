import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { JsonStore, mutate, type DB, type Store } from "../src/core/store";
import { ingest } from "../src/core/ingest";
import { registerAdapter } from "../src/core/adapter";
import { mockAdapter, sent } from "../src/adapters/mock";
import {
  addNote, getThread, listConversations, markRead,
  seedDemo, sendReply, unreadCount, updateConversation,
} from "../src/core/service";
import { readUpload, saveUpload } from "../src/core/media";
import { DEMO_STAFF, actorFromCookie } from "../src/core/staff";
import { canAssign, canView } from "../src/core/policy";
import { overview } from "../src/core/stats";

const [ADMIN, LAN, HAI] = DEMO_STAFF;
registerAdapter(mockAdapter);
registerAdapter({ ...mockAdapter, id: "instagram" }); // kênh Instagram mẫu cũng dùng adapter giả
const mem = () => {
  const s = { db: { channels: {}, contacts: {}, conversations: {}, messages: {} } as DB,
    async load() { return structuredClone(s.db); }, async save(d: DB) { s.db = d; } };
  return s as Store & { db: DB };
};
// Dữ liệu mẫu: u1 của Lan, u2 của Hải, u3 chưa nhận (Instagram), u4 đã xong
const setup = async () => {
  const s = mem();
  await seedDemo(s);
  s.db.channels["demo-fb"].sendEnabled = true;
  return s;
};
const U1 = "demo-fb:conv:u1", U2 = "demo-fb:conv:u2", U3 = "demo-ig:conv:u3";
const ids = (l: Array<{ id: string }>) => l.map((i) => i.id).sort();

test("quyền xem: admin thấy hết; nhân viên chỉ thấy của mình và chưa nhận", async () => {
  const s = await setup();
  assert.deepEqual(ids(await listConversations(s, { status: "all", actor: ADMIN })), [U1, U2, U3, "demo-fb:conv:u4"].sort());
  assert.deepEqual(ids(await listConversations(s, { status: "all", actor: LAN })), [U1, U3, "demo-fb:conv:u4"].sort());
  assert.deepEqual(ids(await listConversations(s, { status: "all", actor: HAI })), [U2, U3, "demo-fb:conv:u4"].sort());
  assert.ok(await getThread(s, U1, LAN));
  assert.equal(await getThread(s, U2, LAN), null); // của Hải
  assert.ok(await getThread(s, U2, ADMIN));
  const fbCh = { access: { lan: "send", hai: "send" } as const };
  assert.equal(canView(LAN, { assigneeUid: "hai" }, fbCh), false);
  assert.equal(canView(LAN, {}, fbCh), true);
  assert.equal(canView(LAN, {}, { access: undefined }), false); // kênh chưa chọn ai: chỉ admin thấy
});

test("nhân viên không đọc, ghi chú, gửi, sửa được hội thoại của người khác", async () => {
  const s = await setup();
  assert.equal((await sendReply(s, U2, { text: "x" }, LAN)).ok, false);
  assert.equal((await addNote(s, U2, "x", LAN)).ok, false);
  assert.equal((await updateConversation(s, U2, { status: "resolved" }, LAN)).ok, false);
  assert.equal(await markRead(s, U2, LAN), false);
  assert.equal(s.db.conversations[U2].status, "open");
  assert.equal((await sendReply(s, U2, { text: "Dạ vâng" }, ADMIN)).ok, true); // admin được
});

test("giao việc: admin giao ai cũng được; nhân viên chỉ nhận về mình hoặc trả lại", async () => {
  const s = await setup();
  assert.equal((await updateConversation(s, U3, { assigneeUid: "hai" }, LAN)).ok, false); // giao cho người khác
  assert.equal((await updateConversation(s, U3, { assigneeUid: "lan" }, LAN)).ok, true); // nhận về mình
  assert.equal(s.db.conversations[U3].assigneeUid, "lan");
  assert.equal((await updateConversation(s, U3, { assigneeUid: null }, LAN)).ok, true); // trả lại
  assert.equal(s.db.conversations[U3].assigneeUid, undefined);
  assert.equal((await updateConversation(s, U1, { assigneeUid: "hai" }, ADMIN)).ok, true);
  assert.equal(s.db.conversations[U1].assigneeUid, "hai");
  assert.equal(canAssign(HAI, { assigneeUid: "lan" }, { access: { lan: "send", hai: "send" } }, "hai"), false); // không cướp của Lan
});

test("trả lời hội thoại chưa nhận thì tự nhận", async () => {
  const s = await setup();
  assert.equal((await sendReply(s, U3, { text: "Dạ" }, LAN)).ok, false); // kênh Instagram demo đang tắt gửi
  s.db.channels["demo-ig"].sendEnabled = true;
  assert.equal((await sendReply(s, U3, { text: "Dạ" }, LAN)).ok, true);
  assert.equal(s.db.conversations[U3].assigneeUid, "lan");
});

test("chưa đọc: tính theo từng người, chỉ trong phạm vi được xem; tin mới làm chưa đọc lại", async () => {
  const s = await setup();
  assert.equal(await unreadCount(s, ADMIN), 3); // u1, u2, u3 (u4 đã xong)
  assert.equal(await unreadCount(s, LAN), 2); // u1, u3 (không thấy u2)
  await markRead(s, U1, LAN);
  assert.equal(await unreadCount(s, LAN), 1);
  assert.equal(await unreadCount(s, ADMIN), 3); // admin chưa đọc gì
  await ingest(s, "facebook", mockAdapter.parse({ page: "PAGE_DEMO", user: "u1", mid: "new1", text: "alo", ts: Date.now() + 1000 }));
  assert.equal(await unreadCount(s, LAN), 2);
});

test("danh sách: lọc Của tôi, Chưa nhận; tìm theo tên, nội dung, nhãn; có thời gian chờ", async () => {
  const s = await setup();
  const mine = await listConversations(s, { status: "all", assignee: "me", actor: LAN });
  assert.deepEqual(ids(mine), [U1]);
  const none = await listConversations(s, { status: "all", assignee: "none", actor: ADMIN });
  assert.deepEqual(ids(none), [U3, "demo-fb:conv:u4"].sort());
  assert.equal((await listConversations(s, { status: "all", q: "quốc bảo", actor: ADMIN })).length, 1);
  assert.equal((await listConversations(s, { status: "all", q: "báo giá", actor: ADMIN })).length, 1);
  assert.equal((await listConversations(s, { status: "all", q: "tour", actor: ADMIN })).length, 1);
  const all = await listConversations(s, { status: "all", actor: ADMIN });
  assert.ok(all.find((i) => i.id === U1)!.waitingSince); // tin cuối là của khách
  assert.equal(all.find((i) => i.id === U3)!.waitingSince, undefined); // tin cuối là của shop
  assert.equal(all.find((i) => i.id === "demo-fb:conv:u4")!.waitingSince, undefined); // đã xong
});

test("ghi chú nội bộ: lưu trong hội thoại, không gửi qua kênh, không thành tin cuối", async () => {
  const s = await setup();
  sent.length = 0;
  assert.equal((await addNote(s, U1, "  ", LAN)).ok, false);
  assert.equal((await addNote(s, U1, "Khách quen, giảm 5%", LAN)).ok, true);
  assert.equal(sent.length, 0);
  const t = await getThread(s, U1, LAN);
  assert.ok(t!.messages.some((m) => m.internal && m.text.includes("giảm 5%")));
  const item = (await listConversations(s, { status: "all", actor: LAN })).find((i) => i.id === U1)!;
  assert.match(item.lastText, /vé máy bay/);
  assert.equal((await addNote(s, "khong-co", "x", ADMIN)).ok, false);
});

test("gửi trả lời: ghi tin, đánh dấu đã đọc; kênh tắt hoặc quá 24 giờ bị chặn", async () => {
  const s = await setup();
  assert.equal((await sendReply(s, U1, { text: "Dạ có ạ" }, LAN)).ok, true);
  const t = await getThread(s, U1, LAN);
  const last = t!.messages[t!.messages.length - 1];
  assert.equal(last.direction, "out");
  assert.equal(last.senderUid, "lan");
  assert.ok((t!.conversation.readBy?.lan ?? 0) >= last.at);
  assert.equal((await sendReply(s, U1, {}, LAN)).ok, false);
  s.db.channels["demo-fb"].sendEnabled = false;
  assert.equal((await sendReply(s, U1, { text: "x" }, LAN)).ok, false);
  s.db.channels["demo-fb"].sendEnabled = true;
  s.db.conversations[U1].lastInboundAt = Date.now() - 25 * 3600_000;
  assert.equal((await sendReply(s, U1, { text: "x" }, LAN)).ok, false);
});

test("khóa ghi: nhiều thao tác đồng thời không làm mất tin", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kpchat-"));
  const s = new JsonStore(path.join(dir, "chat.json"));
  await mutate(s, (db) => { db.channels["c"] = { id: "c", companyId: "x", kind: "facebook", externalId: "P", name: "C", sendEnabled: false }; });
  const evs = Array.from({ length: 40 }, (_, i) => mockAdapter.parse({ page: "P", user: "U" + (i % 5), mid: "m" + i, text: "tin " + i, ts: 1000 + i }));
  await Promise.all(evs.map((e) => ingest(s, "facebook", e)));
  const db = await s.load();
  assert.equal(Object.keys(db.messages).length, 40);
  assert.equal(Object.keys(db.contacts).length, 5);
});

test("tải ảnh: chỉ jpg/png, tối đa 3MB, tên khó đoán; đọc lại đúng; chặn đường dẫn lạ", async () => {
  process.env.KPCHAT_MEDIA_DIR = mkdtempSync(path.join(tmpdir(), "kpmedia-"));
  assert.equal((await saveUpload(new Uint8Array([1]), "image/gif")).ok, false);
  assert.equal((await saveUpload(new Uint8Array(3 * 1024 * 1024 + 1), "image/png")).ok, false);
  assert.equal((await saveUpload(new Uint8Array(0), "image/png")).ok, false);
  const r = await saveUpload(new Uint8Array([1, 2, 3]), "image/png");
  assert.ok(r.ok && /^[0-9a-f]{32}\.png$/.test(r.id));
  const f = await readUpload(r.ok ? r.id : "");
  assert.deepEqual([...f!.bytes], [1, 2, 3]);
  assert.equal(await readUpload("../../etc/passwd"), null);
});

test("người dùng thử: đọc cookie, mặc định là admin, cookie lạ bị bỏ", () => {
  assert.equal(actorFromCookie("kp_actor=lan; x=1").uid, "lan");
  assert.equal(actorFromCookie("a=1; kp_actor=hai").uid, "hai");
  assert.equal(actorFromCookie("kp_actor=ke-gian").uid, "admin");
  assert.equal(actorFromCookie(undefined).role, "admin");
});

test("tổng quan: đếm việc cần xử lý, tải nhân viên, khách chờ lâu và cảnh báo kênh", async () => {
  const s = await setup();
  const now = Date.now();
  const o = await overview(s, now);
  assert.equal(o.totals.open, 3);
  assert.equal(o.totals.unassigned, 1); // u3
  assert.equal(o.totals.waiting, 2); // u1, u2 (tin cuối của khách)
  assert.equal(o.totals.resolvedToday, 0); // hội thoại xong của mẫu là từ hôm qua
  assert.equal(o.totals.slaAny, false); // chưa cài SLA: không có mặc định, không cảnh báo vượt ngưỡng
  assert.equal(o.totals.slaBreach, 0);
  assert.deepEqual(o.staff.map((x) => x.uid).sort(), ["hai", "lan"]);
  assert.equal(o.attention[0].id, U2); // u2 chờ lâu nhất (130 phút)
  assert.ok(o.alerts.some((a) => /chưa có token/.test(a.text) || /chưa có người nhận/.test(a.text)));
  assert.ok(o.channels.every((c) => c.status === "no_token"));
});

test("bật gửi tin: kênh thật phải kết nối xong; kênh mẫu demo được miễn", async () => {
  const { setChannelSend } = await import("../src/core/service");
  const { createChannel } = await import("../src/core/connect");
  const { staticTokens } = await import("../src/core/token-store");
  const s = mem();
  const c = await createChannel(s, { kind: "facebook", name: "Fan", externalId: "P9" });
  if (!c.ok) throw new Error("tạo lỗi");
  const r = await setChannelSend(s, c.channel.id, true);
  assert.equal(r.ok, false); // chưa có token
  assert.equal(s.db.channels[c.channel.id].sendEnabled, false);
  await staticTokens(s).save(c.channel.id, "TOKEN");
  assert.equal((await setChannelSend(s, c.channel.id, true)).ok, true);
  assert.equal((await setChannelSend(s, c.channel.id, false)).ok, true); // tắt luôn được
  await seedDemo(s);
  assert.equal((await setChannelSend(s, "demo-fb", true)).ok, true);
  assert.equal((await setChannelSend(s, "khong-co", false)).ok, false);
});

test("phân quyền theo kênh: không có trong kênh thì không thấy; Chỉ xem không ghi được; giao việc chỉ cho người có mức Nhắn tin", async () => {
  const { setChannelAccess } = await import("../src/core/service");
  const s = await setup();
  // Hải chỉ có mức Xem ở Instagram demo: thấy u3 (chưa nhận) nhưng không trả lời, không nhận, không ghi chú được
  assert.ok(await getThread(s, U3, HAI));
  assert.equal((await sendReply(s, U3, { text: "x" }, HAI)).ok, false);
  assert.equal((await addNote(s, U3, "x", HAI)).ok, false);
  assert.equal((await updateConversation(s, U3, { assigneeUid: "hai" }, HAI)).ok, false);
  // admin không giao được cho người chỉ có mức Xem
  assert.equal((await updateConversation(s, U3, { assigneeUid: "hai" }, ADMIN)).ok, false);
  assert.equal((await updateConversation(s, U3, { assigneeUid: "lan" }, ADMIN)).ok, true);
  // bỏ Lan khỏi kênh: không còn thấy kênh, hội thoại của Lan trong kênh đó trở về chưa nhận
  const r = await setChannelAccess(s, "demo-fb", { hai: "send" }, ["lan", "hai"]);
  assert.equal(r.ok, true);
  assert.deepEqual(ids(await listConversations(s, { status: "all", actor: LAN })), [U3]); // chỉ còn kênh Instagram
  assert.equal(s.db.conversations[U1].assigneeUid, undefined);
  assert.equal(await getThread(s, U1, LAN), null);
  // người lạ hoặc mức lạ bị từ chối
  assert.equal((await setChannelAccess(s, "demo-fb", { ke_gian: "send" }, ["lan", "hai"])).ok, false);
  assert.equal((await setChannelAccess(s, "demo-fb", { lan: "admin" as never }, ["lan", "hai"])).ok, false);
  assert.equal((await setChannelAccess(s, "khong-co", {}, ["lan"])).ok, false);
});
