import test from "node:test";
import assert from "node:assert/strict";
import type { DB, Store } from "../src/core/store";
import { registerAdapter } from "../src/core/adapter";
import { mockAdapter } from "../src/adapters/mock";
import { ingest } from "../src/core/ingest";
import { cleanRouting } from "../src/core/routing";
import { routeUnassigned, runEscalations, setAway, setChannelAccess, setChannelRouting, touchSeen, updateConversation } from "../src/core/service";
import { DEMO_STAFF } from "../src/core/staff";

const [ADMIN, LAN, HAI] = DEMO_STAFF;
registerAdapter(mockAdapter);
const AG = ["lan", "hai"];

const mem = () => {
  const s = { db: { channels: {}, contacts: {}, conversations: {}, messages: {} } as DB,
    async load() { return structuredClone(s.db); }, async save(d: DB) { s.db = d; } };
  return s as Store & { db: DB };
};
// Kênh Messenger có Lan và Hải đều Nhắn tin
const setup = (routing?: unknown) => {
  const s = mem();
  s.db.channels["c"] = { id: "c", companyId: "x", kind: "facebook", externalId: "P", name: "Fan", sendEnabled: true, access: { lan: "send", hai: "send" } };
  return s;
};
let seq = 0;
const inbound = (s: Store, user: string, at = Date.now()) =>
  ingest(s, "facebook", mockAdapter.parse({ page: "P", user, mid: `m${++seq}`, text: "alo", ts: at }));
const owner = (s: { db: DB }, user: string) => s.db.conversations[`c:conv:${user}`]?.assigneeUid;
const route = async (s: Store & { db: DB }, r: unknown) => { const x = await setChannelRouting(s, "c", r); assert.equal(x.ok, true, JSON.stringify(x)); };

test("không đặt chia khách (hoặc thủ công): khách mới ở trạng thái chưa nhận", async () => {
  const s = setup();
  await inbound(s, "u1");
  assert.equal(owner(s, "u1"), undefined);
  await route(s, { mode: "manual" });
  await inbound(s, "u2");
  assert.equal(owner(s, "u2"), undefined);
});

test("xoay vòng đều: lần lượt từng người, vòng lại từ đầu", async () => {
  const s = setup();
  await route(s, { mode: "round_robin" });
  for (const u of ["a", "b", "c", "d", "e"]) await inbound(s, u);
  assert.deepEqual(["a", "b", "c", "d", "e"].map((u) => owner(s, u)), ["lan", "hai", "lan", "hai", "lan"]);
  assert.equal(s.db.conversations["c:conv:a"].autoAssigned, true);
  assert.ok(s.db.conversations["c:conv:a"].assignedAt);
});

test("xoay vòng: bỏ qua người tạm nghỉ, người không có mức Nhắn tin, người chỉ xem; không bao giờ chia cho admin", async () => {
  const s = setup();
  await route(s, { mode: "round_robin" });
  await setAway(s, HAI, "hai", true);
  await inbound(s, "a"); await inbound(s, "b");
  assert.deepEqual([owner(s, "a"), owner(s, "b")], ["lan", "lan"]); // Hải đang nghỉ
  await setAway(s, HAI, "hai", false);
  s.db.channels["c"].access = { lan: "send", hai: "view" }; // Hải chỉ xem
  await inbound(s, "c1");
  assert.equal(owner(s, "c1"), "lan");
  s.db.channels["c"].access = { hai: "view" }; // không ai có mức Nhắn tin
  await inbound(s, "c2");
  assert.equal(owner(s, "c2"), undefined);
  assert.equal((await setAway(s, LAN, "hai", true)).ok, false); // nhân viên không đổi hộ người khác
  assert.equal((await setAway(s, ADMIN, "hai", true)).ok, true); // admin được
  assert.equal((await setAway(s, ADMIN, "admin", true)).ok, false); // admin không phải người nhận khách
});

test("theo tải: giao cho người đang giữ ít hội thoại đang mở nhất", async () => {
  const s = setup();
  await route(s, { mode: "least_busy" });
  await inbound(s, "a"); // cả hai 0: theo thứ tự xoay vòng
  const first = owner(s, "a")!;
  const other = first === "lan" ? "hai" : "lan";
  await inbound(s, "b");
  assert.equal(owner(s, "b"), other); // người kia đang rảnh hơn
  await updateConversation(s, "c:conv:b", { status: "resolved" }, ADMIN); // người kia xong việc
  await inbound(s, "c1");
  assert.equal(owner(s, "c1"), other); // vẫn là người đang ít việc nhất
});

test("giao cố định: luôn một người; người đó nghỉ hoặc mất quyền thì để chưa nhận (không giao nhầm cho người khác)", async () => {
  const s = setup();
  await route(s, { mode: "fixed", fixedUid: "hai" });
  await inbound(s, "a"); await inbound(s, "b");
  assert.deepEqual([owner(s, "a"), owner(s, "b")], ["hai", "hai"]);
  await setAway(s, HAI, "hai", true);
  await inbound(s, "c1");
  assert.equal(owner(s, "c1"), undefined);
});

test("giới hạn số hội thoại đang mở mỗi người; hết chỗ thì để chưa nhận", async () => {
  const s = setup();
  await route(s, { mode: "round_robin", maxOpen: 1 });
  await inbound(s, "a"); await inbound(s, "b"); await inbound(s, "c1");
  assert.deepEqual([owner(s, "a"), owner(s, "b"), owner(s, "c1")], ["lan", "hai", undefined]);
  await updateConversation(s, "c:conv:a", { status: "resolved" }, ADMIN); // Lan xong một hội thoại
  const r = await routeUnassigned(s, "c");
  assert.deepEqual([r.ok && r.assigned, r.ok && r.left], [1, 0]);
  assert.equal(owner(s, "c1"), "lan");
});

test("giờ làm việc của chia khách: ngoài giờ không chia; trong giờ thì chia", async () => {
  const s = setup();
  const allDay = { days: [1, 2, 3, 4, 5, 6, 7], start: "00:00", end: "23:59" };
  await route(s, { mode: "round_robin", hours: allDay });
  await inbound(s, "a");
  assert.equal(owner(s, "a"), "lan");
  // đặt khung giờ đã qua trong ngày hôm nay (giờ VN): luôn nằm ngoài giờ
  const vnNow = new Date(Date.now() + 7 * 3600_000);
  const dow = vnNow.getUTCDay() || 7;
  const otherDays = [1, 2, 3, 4, 5, 6, 7].filter((d) => d !== dow);
  await route(s, { mode: "round_robin", hours: { days: otherDays, start: "08:00", end: "17:00" } });
  await inbound(s, "b");
  assert.equal(owner(s, "b"), undefined);
});

test("khách quay lại: giao lại cho người cũ nếu bật 'quay về người cũ' và người đó đủ điều kiện", async () => {
  const s = setup();
  await route(s, { mode: "round_robin", sticky: true });
  await inbound(s, "a"); await inbound(s, "b"); // a: lan, b: hai
  await updateConversation(s, "c:conv:b", { assigneeUid: null }, ADMIN); // bỏ phụ trách: nhớ người cũ
  assert.equal(s.db.conversations["c:conv:b"].lastAssigneeUid, "hai");
  await routeUnassigned(s, "c");
  assert.equal(owner(s, "b"), "hai"); // về người cũ, không xoay sang Lan
  await updateConversation(s, "c:conv:b", { assigneeUid: null }, ADMIN);
  await setAway(s, HAI, "hai", true);
  await routeUnassigned(s, "c");
  assert.equal(owner(s, "b"), "lan"); // người cũ đang nghỉ: chia cho người khác
});

test("không chia lại hội thoại đã có người; tin đi và hội thoại đã xong không kích hoạt chia", async () => {
  const s = setup();
  await route(s, { mode: "round_robin" });
  await inbound(s, "a");
  assert.equal(owner(s, "a"), "lan");
  await inbound(s, "a"); // tin khách thứ hai: vẫn của Lan, không xoay
  assert.equal(owner(s, "a"), "lan");
  await updateConversation(s, "c:conv:a", { assigneeUid: "hai" }, ADMIN); // admin giao tay
  assert.equal(s.db.conversations["c:conv:a"].autoAssigned, false);
  await inbound(s, "a");
  assert.equal(owner(s, "a"), "hai");
  // khách nhắn lại sau khi hội thoại xong: giữ người cũ (đang giữ), mở lại
  await updateConversation(s, "c:conv:a", { status: "resolved" }, ADMIN);
  await inbound(s, "a");
  assert.equal(s.db.conversations["c:conv:a"].status, "open");
  assert.equal(owner(s, "a"), "hai");
  assert.equal((await routeUnassigned(setup(), "c")).ok, false); // kênh chưa bật chia khách
});

test("bỏ người khỏi kênh: hội thoại họ giữ về chưa nhận, nhớ người cũ, chia lại được cho người còn lại", async () => {
  const s = setup();
  await route(s, { mode: "round_robin" });
  await inbound(s, "a"); await inbound(s, "b"); // a: lan, b: hai
  await setChannelAccess(s, "c", { hai: "send" }, AG);
  assert.equal(owner(s, "a"), undefined);
  assert.equal(s.db.conversations["c:conv:a"].lastAssigneeUid, "lan");
  const r = await routeUnassigned(s, "c");
  assert.equal(r.ok && r.assigned, 1);
  assert.equal(owner(s, "a"), "hai");
});

test("kiểm cấu hình chia khách", () => {
  const send = ["lan", "hai"];
  assert.equal(cleanRouting({ mode: "bay" }, send).ok, false);
  assert.equal(cleanRouting(null, send).ok, false);
  assert.deepEqual(cleanRouting({ mode: "manual", pool: ["x"] }, send), { ok: true, routing: { mode: "manual" } });
  assert.equal(cleanRouting({ mode: "round_robin" }, []).ok, false); // chưa ai có mức Nhắn tin
  assert.equal(cleanRouting({ mode: "fixed" }, send).ok, false);
  assert.equal(cleanRouting({ mode: "fixed", fixedUid: "ke_gian" }, send).ok, false);
  assert.equal(cleanRouting({ mode: "round_robin", pool: ["ke_gian"] }, send).ok, false);
  assert.equal(cleanRouting({ mode: "round_robin", maxOpen: 0 }, send).ok, false);
  assert.equal(cleanRouting({ mode: "round_robin", hours: { days: [], start: "08:00", end: "17:00" } }, send).ok, false);
  const ok = cleanRouting({ mode: "least_busy", pool: ["hai"], maxOpen: 5, sticky: true, hours: { days: [1, 2], start: "08:00", end: "17:00" } }, send);
  assert.ok(ok.ok && ok.routing.pool!.join() === "hai" && ok.routing.maxOpen === 5 && ok.routing.sticky);
  const plain = cleanRouting({ mode: "round_robin" }, send);
  assert.ok(plain.ok && plain.routing.maxOpen === undefined && !plain.routing.hours && !plain.routing.sticky); // không tự thêm mặc định
});

test("cài chia khách: gỡ được, kênh lạ báo lỗi, giữ vị trí xoay vòng khi sửa cùng chế độ", async () => {
  const s = setup();
  await route(s, { mode: "round_robin" });
  await inbound(s, "a"); // lan, cursor = 0
  await route(s, { mode: "round_robin", maxOpen: 10 });
  await inbound(s, "b");
  assert.equal(owner(s, "b"), "hai"); // tiếp tục vòng, không quay lại Lan
  assert.equal((await setChannelRouting(s, "khong-co", { mode: "manual" })).ok, false);
  assert.equal((await setChannelRouting(s, "c", null)).ok, true);
  assert.equal(s.db.channels["c"].routing, undefined);
  void LAN;
});

test("tỷ lệ chia: người có tỷ lệ 2 nhận gấp đôi, xen kẽ trong mỗi vòng", async () => {
  const s = setup();
  await route(s, { mode: "round_robin", weights: { lan: 2 } });
  for (const u of ["a", "b", "c", "d", "e", "f"]) await inbound(s, u);
  const seq = ["a", "b", "c", "d", "e", "f"].map((u) => owner(s, u));
  assert.deepEqual(seq, ["lan", "hai", "lan", "lan", "hai", "lan"]);
  assert.equal(seq.filter((x) => x === "lan").length, 4); // 4 : 2
});

test("theo tải có tỷ lệ: người tỷ lệ cao được giao nhiều việc hơn trước khi coi là bận", async () => {
  const s = setup();
  await route(s, { mode: "least_busy", weights: { lan: 3 } });
  for (const u of ["a", "b", "c", "d"]) await inbound(s, u);
  const lan = ["a", "b", "c", "d"].filter((u) => owner(s, u) === "lan").length;
  assert.equal(lan, 3); // 3 : 1
});

test("ưu tiên trực tuyến: chỉ chia cho người đang mở KP Chat; không ai trực tuyến thì chia đều cho cả nhóm", async () => {
  const s = setup();
  await route(s, { mode: "round_robin", preferOnline: true });
  await inbound(s, "a"); await inbound(s, "b"); // chưa ai mở KP Chat: chia đều
  assert.deepEqual([owner(s, "a"), owner(s, "b")], ["lan", "hai"]);
  await touchSeen(s, "hai"); // Hải trực tuyến
  await inbound(s, "c1"); await inbound(s, "d");
  assert.deepEqual([owner(s, "c1"), owner(s, "d")], ["hai", "hai"]);
  await setAway(s, HAI, "hai", true); // Hải tạm nghỉ: không còn là người trực tuyến, Lan chưa mở nên chia đều (Hải bị loại vì nghỉ)
  await inbound(s, "e");
  assert.equal(owner(s, "e"), "lan");
  // quá 2,5 phút không hoạt động thì không còn tính là trực tuyến
  const { isOnline } = await import("../src/core/routing");
  assert.equal(isOnline({ ...s.db, seen: { lan: 1000 } }, "lan", 1000 + 149_000), true);
  assert.equal(isOnline({ ...s.db, seen: { lan: 1000 } }, "lan", 1000 + 151_000), false);
});

test("chuyển tiếp khi quá N phút: chỉ hội thoại tự chia, một lần cho mỗi tin của khách, không đụng hội thoại giao tay hoặc đã được trả lời", async () => {
  const s = setup();
  await route(s, { mode: "round_robin", escalateMin: 10 });
  const t0 = Date.now();
  await inbound(s, "a", t0); await inbound(s, "b", t0); // a: lan, b: hai
  s.db.conversations["c:conv:a"].lastInboundAt = t0 - 15 * 60_000; // đã chờ 15 phút
  s.db.conversations["c:conv:b"].lastInboundAt = t0 - 15 * 60_000;
  s.db.messages["c:rep"] = { id: "c:rep", companyId: "x", conversationId: "c:conv:b", externalId: "rep", direction: "out", text: "dạ", attachments: [], at: t0 - 5 * 60_000, senderUid: "hai" };
  await runEscalations(s, t0);
  assert.equal(owner(s, "a"), "hai"); // Lan chưa trả lời quá 10 phút: chuyển cho Hải
  assert.equal(s.db.conversations["c:conv:a"].lastAssigneeUid, "lan");
  assert.equal(owner(s, "b"), "hai"); // đã có người trả lời: giữ nguyên
  await runEscalations(s, t0 + 30 * 60_000);
  assert.equal(owner(s, "a"), "hai"); // đã chuyển một lần cho tin này, không chuyển lặp
  // tin khách mới thì tính lại
  s.db.conversations["c:conv:a"].lastInboundAt = t0 + 31 * 60_000 - 20 * 60_000 + 20 * 60_000;
  // hội thoại giao tay không bị chuyển
  await inbound(s, "m", t0); await updateConversation(s, "c:conv:m", { assigneeUid: "lan" }, ADMIN);
  s.db.conversations["c:conv:m"].lastInboundAt = t0 - 60 * 60_000;
  await runEscalations(s, t0);
  assert.equal(owner(s, "m"), "lan");
});

test("chuyển tiếp: không có người khác đủ điều kiện thì giữ nguyên; kênh không bật thì không chạy", async () => {
  const s = setup();
  await route(s, { mode: "round_robin", escalateMin: 5, pool: ["lan"] });
  const t0 = Date.now();
  await inbound(s, "a", t0);
  s.db.conversations["c:conv:a"].lastInboundAt = t0 - 20 * 60_000;
  await runEscalations(s, t0);
  assert.equal(owner(s, "a"), "lan"); // chỉ có Lan trong nhóm
  const s2 = setup();
  await route(s2, { mode: "round_robin" });
  await inbound(s2, "a", t0);
  s2.db.conversations["c:conv:a"].lastInboundAt = t0 - 99 * 60_000;
  assert.equal(await runEscalations(s2, t0), 0);
});

test("kiểm tỷ lệ chia và chuyển tiếp", () => {
  const send = ["lan", "hai"];
  assert.equal(cleanRouting({ mode: "round_robin", weights: { lan: 0 } }, send).ok, false);
  assert.equal(cleanRouting({ mode: "round_robin", weights: { lan: 11 } }, send).ok, false);
  assert.equal(cleanRouting({ mode: "round_robin", weights: { ke_gian: 2 } }, send).ok, false);
  assert.equal(cleanRouting({ mode: "round_robin", escalateMin: 0 }, send).ok, false);
  const ok = cleanRouting({ mode: "round_robin", weights: { lan: 2 }, preferOnline: true, escalateMin: 10 }, send);
  assert.ok(ok.ok && ok.routing.weights!.lan === 2 && ok.routing.preferOnline && ok.routing.escalateMin === 10);
  const fx = cleanRouting({ mode: "fixed", fixedUid: "lan", weights: { lan: 2 }, escalateMin: 5, preferOnline: true }, send);
  assert.deepEqual(fx, { ok: true, routing: { mode: "fixed", fixedUid: "lan" } }); // chế độ cố định bỏ các tùy chọn không áp dụng
});
