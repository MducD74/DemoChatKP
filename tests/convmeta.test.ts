import test from "node:test";
import assert from "node:assert/strict";
import type { DB, Store } from "../src/core/store";
import { changeTask, getLabelCfg, getThread, listConversations, setLabelCfg, updateContactInfo, updateConversation } from "../src/core/service";
import { cleanLabelCfg, DEFAULT_LABEL_CFG, labelViews, matchLabels, toggleLabel } from "../src/core/labels";
import { LOST_REASONS, STAGES } from "../src/core/convmeta";
import { DEMO_STAFF } from "../src/core/staff";
import { hostProfile } from "../src/core/hostprofile";

const [ADMIN, LAN, HAI] = DEMO_STAFF;
const mem = () => {
  const s = { db: { channels: {}, contacts: {}, conversations: {}, messages: {} } as DB,
    async load() { return structuredClone(s.db); }, async save(d: DB) { s.db = d; } };
  return s as Store & { db: DB };
};
const setup = () => {
  const s = mem();
  s.db.channels["c"] = { id: "c", companyId: "x", kind: "facebook", externalId: "P", name: "Fanpage", sendEnabled: true, access: { [LAN.uid]: "send", [HAI.uid]: "view" } };
  s.db.contacts["k"] = { id: "k", companyId: "x", channelId: "c", externalId: "k", name: "Khách A" };
  s.db.conversations["v"] = { id: "v", companyId: "x", channelId: "c", contactId: "k", status: "open", labels: [], lastInboundAt: 1, lastMessageAt: 1 };
  return s;
};
const conv = (s: { db: DB }) => s.db.conversations["v"];

test("thang giai đoạn giống KP CRM (6 bậc, Chuyển đổi và Mất/Spam là hai đầu), có lý do mất đơn", () => {
  assert.deepEqual(STAGES.map((s) => s.key), ["new", "interest", "potential", "near", "won", "lost"]);
  assert.ok(LOST_REASONS.length >= 5);
});

test("đổi giai đoạn: ghi lại, vào danh sách; Mất/Spam bắt buộc có lý do hợp lệ; bỏ giai đoạn xóa lý do", async () => {
  const s = setup();
  assert.equal((await updateConversation(s, "v", { stage: "near" }, LAN)).ok, true);
  assert.equal(conv(s).stage, "near");
  assert.equal((await listConversations(s, { actor: LAN, status: "all" }))[0].stage, "near");
  const noReason = await updateConversation(s, "v", { stage: "lost" }, LAN);
  assert.equal(noReason.ok, false);
  assert.equal(!noReason.ok && noReason.code, 400);
  assert.equal((await updateConversation(s, "v", { stage: "lost", lostReason: "lý do bịa" }, LAN)).ok, false);
  assert.equal(conv(s).stage, "near", "lỗi thì không đổi gì");
  assert.equal((await updateConversation(s, "v", { stage: "lost", lostReason: LOST_REASONS[0] }, LAN)).ok, true);
  assert.equal(conv(s).lostReason, LOST_REASONS[0]);
  assert.equal((await updateConversation(s, "v", { stage: "interest" }, LAN)).ok, true);
  assert.equal(conv(s).lostReason, undefined, "rời Mất/Spam thì bỏ lý do");
  assert.equal((await updateConversation(s, "v", { stage: "không có" }, LAN)).ok, false);
  assert.equal((await updateConversation(s, "v", { stage: null }, LAN)).ok, true);
  assert.equal(conv(s).stage, undefined);
  assert.match((conv(s).log ?? []).map((l) => l.text).join("|"), /Đổi giai đoạn CRM: chưa có → Gần chốt.*Mất\/Spam \(Giá chưa phù hợp\).*Bỏ giai đoạn CRM/);
});

test("lịch sử thao tác: giao khách, nhận khách, tình trạng, nhãn đều được ghi kèm người làm; chỉ ghi khi có đổi thật", async () => {
  const s = setup();
  await updateConversation(s, "v", { assigneeUid: LAN.uid }, LAN);
  await updateConversation(s, "v", { assigneeUid: LAN.uid }, LAN); // không đổi: không ghi thêm
  await updateConversation(s, "v", { status: "pending", labels: ["Hộp quà", "Chốt"] }, LAN);
  await updateConversation(s, "v", { labels: ["Chốt"] }, LAN);
  const texts = (conv(s).log ?? []).map((l) => l.text);
  assert.deepEqual(texts, ["Nhận khách", "Đổi tình trạng: Đang mở → Chờ", "Gắn nhãn: Hộp quà, Chốt", "Bỏ nhãn: Hộp quà"]);
  assert.ok((conv(s).log ?? []).every((l) => l.by === LAN.uid));
  for (let i = 0; i < 130; i++) await updateConversation(s, "v", { status: i % 2 ? "open" : "pending" }, LAN);
  assert.equal(conv(s).log?.length, 100, "giữ 100 dòng mới nhất");
});

test("sửa thông tin khách: số điện thoại, địa chỉ, khu vực; kiểm dữ liệu; chỉ người có quyền Nhắn tin", async () => {
  const s = setup();
  assert.equal((await updateContactInfo(s, "v", { phone: "0905 123.456", address: "  12  Lê Lợi ", area: "Hải Châu" }, LAN)).ok, true);
  assert.deepEqual([s.db.contacts["k"].phone, s.db.contacts["k"].address, s.db.contacts["k"].area], ["0905123456", "12 Lê Lợi", "Hải Châu"]);
  assert.equal((await listConversations(s, { actor: LAN, status: "all" }))[0].hasPhone, true);
  assert.equal((await updateContactInfo(s, "v", { phone: "abc" }, LAN)).ok, false);
  assert.equal((await updateContactInfo(s, "v", { phone: "123" }, LAN)).ok, false);
  assert.equal((await updateContactInfo(s, "v", { address: "x".repeat(201) }, LAN)).ok, false);
  assert.equal((await updateContactInfo(s, "v", { phone: "0905123456" }, HAI)).ok, false, "chỉ xem thì không sửa được");
  assert.equal((await updateContactInfo(s, "v", { phone: "", address: "", area: "" }, LAN)).ok, true);
  assert.equal(s.db.contacts["k"].phone, undefined, "để trống là xóa");
});

test("việc cần làm: thêm, đánh dấu xong, xóa; kiểm nội dung, ngày hạn, giới hạn; có ghi lịch sử", async () => {
  const s = setup();
  assert.equal((await changeTask(s, "v", { add: { text: "  Gọi báo giá  hộp quà ", due: "2026-12-01" } }, LAN)).ok, true);
  const id = conv(s).tasks![0].id;
  assert.equal(conv(s).tasks![0].text, "Gọi báo giá hộp quà");
  assert.equal((await changeTask(s, "v", { add: { text: "" } }, LAN)).ok, false);
  assert.equal((await changeTask(s, "v", { add: { text: "x", due: "mai" } }, LAN)).ok, false);
  assert.equal((await changeTask(s, "v", { add: { text: "x".repeat(201) } }, LAN)).ok, false);
  assert.equal((await changeTask(s, "v", { done: { taskId: id, value: true } }, LAN)).ok, true);
  assert.equal(conv(s).tasks![0].done, true);
  assert.equal((await changeTask(s, "v", { done: { taskId: "không có", value: true } }, LAN)).ok, false);
  assert.equal((await changeTask(s, "v", { add: { text: "việc" } }, HAI)).ok, false, "chỉ xem thì không thêm được");
  assert.equal((await changeTask(s, "v", { remove: id }, LAN)).ok, true);
  assert.equal(conv(s).tasks!.length, 0);
  assert.match((conv(s).log ?? []).map((l) => l.text).join("|"), /Thêm việc: Gọi báo giá hộp quà\|Xong việc: .*\|Xóa việc/);
  for (let i = 0; i < 50; i++) await changeTask(s, "v", { add: { text: `v${i}` } }, LAN);
  assert.equal((await changeTask(s, "v", { add: { text: "thừa" } }, LAN)).ok, false, "tối đa 50 việc");
  const t = await getThread(s, "v", LAN);
  assert.equal(t?.conversation.tasks?.length, 50);
});

test("danh mục nhãn: mặc định phẳng 6 nhãn, không có Chốt hay nguồn; chỉ quản trị lưu; làm sạch dữ liệu", async () => {
  const s = setup();
  assert.deepEqual(await getLabelCfg(s), DEFAULT_LABEL_CFG);
  assert.deepEqual(Object.keys(DEFAULT_LABEL_CFG.labels), ["Hộp quà", "Giỏ quà", "Trái cây cắt sẵn", "Nước ép", "Khiếu nại", "VIP"]);
  assert.equal(DEFAULT_LABEL_CFG.groups.length, 1, "chỉ một nhóm ngầm, không hiện ra");
  assert.equal((await setLabelCfg(s, DEFAULT_LABEL_CFG, LAN)).ok, false, "nhân viên không sửa");
  const r = await setLabelCfg(s, { groups: [{ name: "Loại", single: true }, { name: "Khác" }], labels: { a: { name: " VIP ", color: "đỏ", group: "không có" }, b: { name: "Chốt", color: "#16a34a", group: "Loại", pinned: true, order: 5 }, c: { name: "  " } } }, ADMIN);
  assert.equal(r.ok, true);
  const cfg = await getLabelCfg(s);
  assert.deepEqual(Object.keys(cfg.labels).sort(), ["Chốt", "VIP"]);
  assert.equal(cfg.labels["VIP"].color, "#9CA3AF", "màu sai thì dùng màu xám");
  assert.equal(cfg.labels["VIP"].group, "Khác", "nhóm không có thì rơi vào nhóm cuối");
  assert.equal(cfg.labels["Chốt"].pinned, true);
  for (const bad of [{ groups: [], labels: {} }, { groups: [{ name: "a" }, { name: "a" }], labels: {} }, { groups: [{ name: "" }], labels: {} }, { groups: [{ name: "x".repeat(31) }], labels: {} }, null]) assert.equal(cleanLabelCfg(bad).ok, false, JSON.stringify(bad));
  assert.equal(cleanLabelCfg({ groups: [{ name: "a" }], labels: { x: { name: "y".repeat(41) } } }).ok, false);
});

test("gắn nhãn: gắn được nhiều nhãn; nhóm một lựa chọn của dữ liệu cũ vẫn chạy; nhãn lạ vẫn hiện; nhãn ẩn chỉ hiện khi đang gắn; xếp theo thứ tự", () => {
  const cfg = DEFAULT_LABEL_CFG;
  assert.deepEqual(toggleLabel(["Hộp quà"], "Giỏ quà", true, cfg).sort(), ["Giỏ quà", "Hộp quà"], "gắn được nhiều nhãn");
  assert.deepEqual(toggleLabel(["VIP"], "VIP", false, cfg), []);
  assert.deepEqual(toggleLabel(["VIP"], "VIP", true, cfg), ["VIP"], "không gắn trùng");
  assert.deepEqual(toggleLabel([], "Nhãn lạ", true, cfg), ["Nhãn lạ"]);
  const old = { groups: [{ name: "Kết quả", single: true }], labels: { A: { name: "A", color: "#111111", group: "Kết quả" }, B: { name: "B", color: "#222222", group: "Kết quả" } } };
  assert.deepEqual(toggleLabel(["A"], "B", true, old), ["B"], "cấu hình cũ có nhóm một lựa chọn vẫn gỡ nhãn cũ");
  const views = labelViews({ ...cfg, labels: { ...cfg.labels, "Nước ép": { ...cfg.labels["Nước ép"], hidden: true } } }, ["Nhãn lạ", "Nước ép"]);
  assert.ok(views.some((v) => v.name === "Nhãn lạ" && !v.known));
  assert.ok(views.some((v) => v.name === "Nước ép"), "đang gắn thì vẫn hiện dù đã ẩn");
  assert.equal(labelViews({ ...cfg, labels: { ...cfg.labels, "Nước ép": { ...cfg.labels["Nước ép"], hidden: true } } }).some((v) => v.name === "Nước ép"), false);
  assert.deepEqual(labelViews(cfg).slice(0, 3).map((v) => v.name), ["Hộp quà", "Giỏ quà", "Trái cây cắt sẵn"]);
});

test("nhiệm vụ có đủ trường như KP Chat 1: tên, ưu tiên, ngày và giờ hạn, người thực hiện, ghi chú; kiểm từng trường", async () => {
  const s = setup();
  const ok = await changeTask(s, "v", { add: { text: "Gọi báo giá", due: "2026-12-02", time: "09:30", priority: "high", owner: LAN.uid, note: " khách cần gấp " } }, ADMIN);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.deepEqual({ ...conv(s).tasks![0], id: "", at: 0 }, { id: "", text: "Gọi báo giá", due: "2026-12-02", time: "09:30", priority: "high", owner: LAN.uid, note: "khách cần gấp", by: ADMIN.uid, at: 0 });
  for (const add of [{ text: "x", time: "25:00" }, { text: "x", time: "9h" }, { text: "x", priority: "gấp" }, { text: "x", owner: "người lạ" }, { text: "x", note: "y".repeat(201) }]) {
    assert.equal((await changeTask(s, "v", { add }, ADMIN)).ok, false, JSON.stringify(add));
  }
  assert.equal(conv(s).tasks!.length, 1, "nhiệm vụ lỗi không lọt vào kho");
});

test("hồ sơ từ hệ thống nối: bản chạy riêng chưa nối KP CRM và POS; lead là giai đoạn của hội thoại, việc tiếp là nhiệm vụ gần hạn nhất chưa xong", async () => {
  const s = setup();
  let p = hostProfile(conv(s), s.db.contacts["k"]);
  assert.deepEqual(p.linked, { crm: false, pos: false });
  assert.equal(p.lead, undefined, "chưa có giai đoạn thì chưa có lead");
  assert.equal(p.kov, undefined);
  assert.equal(p.buys, undefined);
  await updateConversation(s, "v", { stage: "near" }, LAN);
  await changeTask(s, "v", { add: { text: "Việc sau", due: "2026-12-09" } }, LAN);
  await changeTask(s, "v", { add: { text: "Việc gần", due: "2026-12-01" } }, LAN);
  await changeTask(s, "v", { add: { text: "Việc đã xong", due: "2026-11-25" } }, LAN);
  await changeTask(s, "v", { done: { taskId: conv(s).tasks![2].id, value: true } }, LAN);
  p = hostProfile(conv(s), s.db.contacts["k"]);
  assert.equal(p.lead?.stageName, "Gần chốt");
  assert.equal(p.lead?.core, "near");
  assert.equal(p.lead?.nextAction, "Việc gần");
  assert.equal(p.lead?.nextDue, "2026-12-01");
  assert.equal((await getThread(s, "v", LAN))?.profile.lead?.stageName, "Gần chốt", "hồ sơ đi kèm khi mở hội thoại");
});

test("lọc nhiều nhãn: không chọn thì khớp hết; mặc định có một trong các nhãn; chế độ đủ nhãn thì phải có tất cả", () => {
  const have = ["Chốt", "Hộp quà"];
  assert.equal(matchLabels(have, [], false), true);
  assert.equal(matchLabels([], [], true), true);
  assert.equal(matchLabels(have, ["Hộp quà", "Giỏ quà"], false), true, "có một trong hai");
  assert.equal(matchLabels(have, ["Hộp quà", "Giỏ quà"], true), false, "thiếu Giỏ quà");
  assert.equal(matchLabels(have, ["Chốt", "Hộp quà"], true), true);
  assert.equal(matchLabels(have, ["Khiếu nại"], false), false);
  assert.equal(matchLabels([], ["Chốt"], false), false);
});

// ---------- Nhóm kênh ----------
import { cleanChannelGroups, matchChannel, sameSet, selectionText, type ChannelGroup } from "../src/core/channelgroups";
import { getChannelGroups, setChannelGroups } from "../src/core/service";

test("nhóm kênh: làm sạch (tên không trống hoặc trùng, kênh phải có thật, cần từ hai kênh), tối đa 10 nhóm", () => {
  const known = ["a", "b", "c"];
  const ok = cleanChannelGroups([{ name: "  Facebook   XuXi ", channelIds: ["a", "b", "b", "zzz"] }, { id: "g-keep", name: "Zalo", channelIds: ["b", "c"] }], known);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.deepEqual(ok.groups.map((g) => [g.name, g.channelIds]), [["Facebook XuXi", ["a", "b"]], ["Zalo", ["b", "c"]]], "kênh trùng và kênh lạ bị bỏ, khoảng trắng gọn lại");
    assert.equal(ok.groups[1].id, "g-keep");
    assert.match(ok.groups[0].id, /^g-/);
  }
  for (const bad of [[{ name: "", channelIds: ["a", "b"] }], [{ name: "x", channelIds: ["a"] }], [{ name: "x", channelIds: ["a", "zzz"] }], [{ name: "A", channelIds: ["a", "b"] }, { name: "a", channelIds: ["b", "c"] }], [{ name: "y".repeat(31), channelIds: ["a", "b"] }], "x", null]) {
    assert.equal(cleanChannelGroups(bad, known).ok, false, JSON.stringify(bad));
  }
  assert.equal(cleanChannelGroups(Array.from({ length: 11 }, (_, i) => ({ name: `n${i}`, channelIds: ["a", "b"] })), known).ok, false);
});

test("chọn nhiều kênh: không chọn là tất cả; chọn vài kênh thì chỉ hội thoại của các kênh đó; chữ trên nút theo lựa chọn", () => {
  assert.equal(matchChannel("a", []), true);
  assert.equal(matchChannel("a", ["a", "b"]), true);
  assert.equal(matchChannel("c", ["a", "b"]), false);
  assert.equal(sameSet(["a", "b"], ["b", "a"]), true);
  assert.equal(sameSet(["a"], ["a", "b"]), false);
  const groups: ChannelGroup[] = [{ id: "g1", name: "Facebook XuXi", channelIds: ["a", "b"] }];
  const names = { a: "Page A", b: "Page B", c: "Zalo C" };
  assert.equal(selectionText([], groups, names, 8), "Tất cả kênh (8)");
  assert.equal(selectionText(["a"], groups, names, 8), "Page A");
  assert.equal(selectionText(["b", "a"], groups, names, 8), "Facebook XuXi", "đúng bằng một nhóm thì hiện tên nhóm");
  assert.equal(selectionText(["a", "c"], groups, names, 8), "2 kênh");
  assert.equal(selectionText(["x"], groups, names, 8), "1 kênh", "kênh không rõ tên");
});

test("nhóm kênh lưu theo từng người: người này không thấy nhóm của người kia; kênh không có thật bị từ chối", async () => {
  const s = setup();
  s.db.channels["d"] = { id: "d", companyId: "x", kind: "zalo_personal", externalId: "Z", name: "Zalo", sendEnabled: true };
  assert.deepEqual(await getChannelGroups(s, LAN.uid), []);
  const r = await setChannelGroups(s, LAN.uid, [{ name: "Của Lan", channelIds: ["c", "d"] }]);
  assert.equal(r.ok, true);
  assert.equal((await getChannelGroups(s, LAN.uid))[0].name, "Của Lan");
  assert.deepEqual(await getChannelGroups(s, HAI.uid), [], "người khác không thấy");
  const bad = await setChannelGroups(s, LAN.uid, [{ name: "Sai", channelIds: ["c", "khong-co"] }]);
  assert.equal(bad.ok, false);
  assert.equal(!bad.ok && bad.code, 400);
  assert.equal((await getChannelGroups(s, LAN.uid))[0].name, "Của Lan", "lỗi thì giữ nhóm cũ");
  assert.equal((await setChannelGroups(s, LAN.uid, [])).ok, true, "xóa hết nhóm");
});

// ---------- Bộ lọc thời gian ----------
import { inRange, TIME_OPTIONS, timeRange } from "../src/core/timefilter";
const vn = (s: string) => Date.parse(`${s}+07:00`);

test("bộ lọc thời gian theo giờ Việt Nam: Hôm nay, Hôm qua, Tuần này (từ thứ Hai), Tuần qua, Tháng này, Tháng qua", () => {
  assert.deepEqual(TIME_OPTIONS.map(([k]) => k), ["all", "today", "yesterday", "week", "lastweek", "month", "lastmonth", "custom"]);
  const now = vn("2026-11-22T21:00:00"); // Chủ nhật
  const r = (k: string) => timeRange(k, now)!;
  assert.deepEqual(r("today"), { from: vn("2026-11-22T00:00:00"), to: vn("2026-11-23T00:00:00") });
  assert.deepEqual(r("yesterday"), { from: vn("2026-11-21T00:00:00"), to: vn("2026-11-22T00:00:00") });
  assert.deepEqual(r("week"), { from: vn("2026-11-16T00:00:00"), to: vn("2026-11-23T00:00:00") }, "tuần bắt đầu thứ Hai 16/11, Chủ nhật vẫn thuộc tuần này");
  assert.deepEqual(r("lastweek"), { from: vn("2026-11-09T00:00:00"), to: vn("2026-11-16T00:00:00") });
  assert.deepEqual(r("month"), { from: vn("2026-11-01T00:00:00"), to: vn("2026-12-01T00:00:00") });
  assert.deepEqual(r("lastmonth"), { from: vn("2026-10-01T00:00:00"), to: vn("2026-11-01T00:00:00") });
  assert.equal(timeRange("all", now), null);
  assert.equal(timeRange("khac", now), null);
});

test("bộ lọc thời gian: ranh giới nửa đêm giờ Việt Nam, qua đầu năm, thứ Hai lúc 0 giờ", () => {
  const mon = vn("2026-01-05T00:30:00"); // thứ Hai đầu tuần, đầu năm
  assert.deepEqual(timeRange("week", mon), { from: vn("2026-01-05T00:00:00"), to: vn("2026-01-12T00:00:00") });
  assert.deepEqual(timeRange("lastweek", mon), { from: vn("2025-12-29T00:00:00"), to: vn("2026-01-05T00:00:00") });
  assert.deepEqual(timeRange("lastmonth", mon), { from: vn("2025-12-01T00:00:00"), to: vn("2026-01-01T00:00:00") });
  const day = timeRange("today", vn("2026-11-22T23:59:59"))!;
  assert.equal(inRange(vn("2026-11-22T00:00:00"), day), true, "đúng 0 giờ tính là hôm nay");
  assert.equal(inRange(vn("2026-11-21T23:59:59"), day), false);
  assert.equal(inRange(vn("2026-11-23T00:00:00"), day), false, "0 giờ hôm sau đã sang ngày khác");
  // 17 giờ UTC ngày 21 là 0 giờ ngày 22 giờ Việt Nam
  assert.equal(inRange(Date.parse("2026-11-21T17:00:00Z"), day), true);
  assert.equal(inRange(Date.parse("2026-11-21T16:59:59Z"), day), false);
  assert.equal(inRange(5, null), true, "không lọc thì khớp hết");
});

test("bộ lọc thời gian Tùy chọn: từ ngày, đến ngày (tính hết ngày đó), chỉ một đầu, chưa chọn thì không lọc, ngày sai bị bỏ", () => {
  const now = vn("2026-11-22T12:00:00");
  const both = timeRange("custom", now, { from: "2026-11-10", to: "2026-11-12" })!;
  assert.deepEqual(both, { from: vn("2026-11-10T00:00:00"), to: vn("2026-11-13T00:00:00") });
  assert.equal(inRange(vn("2026-11-12T23:30:00"), both), true, "ngày đến tính hết ngày");
  assert.equal(inRange(vn("2026-11-13T00:00:00"), both), false);
  const onlyFrom = timeRange("custom", now, { from: "2026-11-20" })!;
  assert.equal(inRange(vn("2026-11-25T00:00:00"), onlyFrom), true);
  assert.equal(inRange(vn("2026-11-19T23:59:59"), onlyFrom), false);
  const onlyTo = timeRange("custom", now, { to: "2026-11-05" })!;
  assert.equal(inRange(vn("2020-01-01T00:00:00"), onlyTo), true);
  assert.equal(inRange(vn("2026-11-06T00:00:00"), onlyTo), false);
  assert.equal(timeRange("custom", now, {}), null);
  assert.equal(timeRange("custom", now, { from: "hôm qua", to: "2026-13-45" }), null, "ngày sai thì bỏ qua");
  assert.deepEqual(timeRange("custom", now, { from: "2026-11-10", to: "2026-11-10" }), { from: vn("2026-11-10T00:00:00"), to: vn("2026-11-11T00:00:00") }, "một ngày");
});
