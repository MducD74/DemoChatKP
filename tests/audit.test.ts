import test from "node:test";
import assert from "node:assert/strict";
import type { DB, Store } from "../src/core/store";
import { addNote, changeTask, updateContactInfo, updateConversation } from "../src/core/service";
import { AUDIT_KEEP, addAudit, getAudit, logOpen, OPEN_DEDUPE_MS } from "../src/core/audit";
import { DEMO_STAFF } from "../src/core/staff";

const [ADMIN, LAN, HAI] = DEMO_STAFF;
const mem = () => {
  const s = { db: { channels: {}, contacts: {}, conversations: {}, messages: {} } as DB,
    async load() { return structuredClone(s.db); }, async save(d: DB) { s.db = d; } };
  return s as Store & { db: DB };
};
const setup = () => {
  const s = mem();
  s.db.channels["c"] = { id: "c", companyId: "x", kind: "facebook", externalId: "P", name: "Fanpage", sendEnabled: true, access: { [LAN.uid]: "send", [HAI.uid]: "view" } } as never;
  s.db.contacts["k"] = { id: "k", companyId: "x", channelId: "c", externalId: "k", name: "Khách A", phone: "0905123456" } as never;
  s.db.conversations["v"] = { id: "v", companyId: "x", channelId: "c", contactId: "k", status: "open", labels: [], lastInboundAt: 1, lastMessageAt: 1 } as never;
  return s;
};

test("nhật ký: thao tác trên hội thoại được ghi kèm tên kênh và khách, dòng mới ở đầu", async () => {
  const s = setup();
  await updateConversation(s, "v", { labels: ["VIP"] }, LAN);
  await updateContactInfo(s, "v", { phone: "0905999888" }, LAN);
  await changeTask(s, "v", { add: { text: "Gọi báo giá" } }, LAN);
  await addNote(s, "v", "khách khó tính", LAN);
  const rows = await getAudit(s, ADMIN);
  assert.deepEqual(rows.map((r) => r.action), ["Ghi chú nội bộ", "Thêm việc: Gọi báo giá", "Sửa thông tin khách", "Gắn nhãn: VIP"]);
  assert.equal(rows[0].target, "Fanpage · Khách A", "tên dễ đọc, không phải mã dài");
  assert.equal(rows[0].who, LAN.name);
});

test("nhật ký: chỉ quản trị xem được; thao tác bị từ chối cũng được ghi", async () => {
  const s = setup();
  assert.equal((await updateConversation(s, "v", { labels: ["VIP"] }, HAI)).ok, false, "Hải chỉ có quyền xem");
  assert.deepEqual(await getAudit(s, LAN), [], "nhân viên không xem nhật ký");
  const r = (await getAudit(s, ADMIN))[0];
  assert.match(r.action, /^Bị từ chối/);
  assert.match(r.target ?? "", /Fanpage · Khách A/);
  assert.equal(r.who, HAI.name);
});

test("nhật ký: mở hội thoại ghi một lần, mở lại trong 1 phút thì bỏ qua, ghi chú có xem SĐT; giữ tối đa số dòng quy định", async () => {
  const s = setup();
  assert.equal(await logOpen(s, "v", LAN, 1000), true);
  assert.equal(await logOpen(s, "v", LAN, 1000 + OPEN_DEDUPE_MS - 1), false);
  assert.equal(await logOpen(s, "v", HAI, 2000), true, "người khác vẫn ghi");
  assert.equal(await logOpen(s, "v", LAN, 1000 + OPEN_DEDUPE_MS), true);
  assert.equal(await logOpen(s, "không có", LAN), false);
  const rows = await getAudit(s, ADMIN);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].target, "Fanpage · Khách A (xem SĐT)");
  for (let i = 0; i < AUDIT_KEEP + 50; i++) addAudit(s.db, ADMIN, `x${i}`);
  assert.equal(s.db.audit!.length, AUDIT_KEEP);
  assert.equal(s.db.audit![0].action, `x${AUDIT_KEEP + 49}`, "dòng mới nhất giữ lại");
  assert.equal((await getAudit(s, ADMIN)).length, 400, "tab chỉ hiện 400 dòng gần nhất");
});
