// Cảnh báo vận hành (2.5, 6.2) và tìm kiếm trong hộp thư (3.1).
import test from "node:test";
import assert from "node:assert/strict";
import { buildAlerts } from "../src/core/alerts";
import { searchConversations } from "../src/core/service";
import { DEMO_STAFF } from "../src/core/staff";
import type { DB, Store } from "../src/core/store";

const [ADMIN, LAN, HAI] = DEMO_STAFF;

test("cảnh báo: token hết hạn là lỗi, Page chưa đăng ký nhận tin là chú ý, webhook không truy cập được là lỗi", () => {
  const channels = [{ id: "a", name: "Xuxi thử", kind: "facebook" }, { id: "b", name: "Page B", kind: "facebook" }, { id: "c", name: "Đã tắt", kind: "facebook", off: true }];
  const health = { a: { ok: false, error: "Token hết hạn hoặc bị thu hồi" }, b: { ok: true, subscribed: false }, c: { ok: false } };
  const out = buildAlerts({ channels, health, webhook: { configured: true, reachable: false, detail: "Địa chỉ trả về mã 530" } });
  assert.deepEqual(out.map((a) => [a.key, a.level]), [["webhook", "error"], ["token:a", "error"], ["sub:b", "warn"]]);
  assert.match(out[1].text, /Kết nối lại/);
  assert.match(out[0].text, /530/);
  assert.deepEqual(buildAlerts({ channels, health: { a: { ok: true, subscribed: true } }, webhook: { configured: false } }), []);
});

const mem = (db: DB) => ({ db, async load() { return structuredClone(this.db); }, async save(d: DB) { this.db = d; } }) as Store & { db: DB };
function seed(): DB {
  const db: DB = { channels: {}, contacts: {}, conversations: {}, messages: {} };
  db.channels.c = { id: "c", companyId: "x", kind: "facebook", externalId: "P", name: "Page thử", sendEnabled: true, access: { lan: "send" } };
  const add = (u: string, name: string, phone: string | undefined, assignee: string | undefined, texts: string[]) => {
    db.contacts[`c:${u}`] = { id: `c:${u}`, companyId: "x", channelId: "c", externalId: u, name, ...(phone ? { phone } : {}) };
    db.conversations[`c:conv:${u}`] = { id: `c:conv:${u}`, companyId: "x", channelId: "c", contactId: `c:${u}`, status: "open", labels: u === "u3" ? ["Hộp quà"] : [], ...(assignee ? { assigneeUid: assignee } : {}) };
    texts.forEach((t, i) => { db.messages[`c:${u}${i}`] = { id: `c:${u}${i}`, companyId: "x", conversationId: `c:conv:${u}`, externalId: `${u}${i}`, direction: i % 2 ? "out" : "in", text: t, attachments: [], at: 1000 + i }; });
  };
  add("u1", "Nguyễn Thị Hoa", "0905 123 456", "lan", ["Cho em hỏi xoài cắt sẵn giá bao nhiêu", "Dạ 45.000đ ạ", "Ok cảm ơn shop"]);
  add("u2", "Trần Văn Nam", undefined, "hai", ["Giao Hải Châu mất bao lâu?"]);
  add("u3", "Lê Minh", undefined, undefined, ["Alo"]);
  return db;
}

test("tìm: trong mọi tin (không chỉ tin cuối), không dấu, có đoạn trích", async () => {
  const s = mem(seed());
  const hits = await searchConversations(s, ADMIN, "xoai cat san");
  assert.deepEqual(hits.map((h) => h.id), ["c:conv:u1"]);
  assert.match(hits[0].snippet!, /xoài cắt sẵn/);
});

test("tìm: theo tên, số điện thoại (bỏ khoảng trắng), nhãn", async () => {
  const s = mem(seed());
  assert.deepEqual((await searchConversations(s, ADMIN, "hoa")).map((h) => h.id), ["c:conv:u1"]);
  assert.deepEqual((await searchConversations(s, ADMIN, "0905123")).map((h) => h.id), ["c:conv:u1"]);
  assert.deepEqual((await searchConversations(s, ADMIN, "hop qua")).map((h) => h.id), ["c:conv:u3"]);
  assert.deepEqual(await searchConversations(s, ADMIN, "x"), [], "ít hơn 2 ký tự thì không tìm");
});

test("tìm: nhân viên chỉ thấy hội thoại mình được xem (của mình và chưa nhận ở kênh có quyền)", async () => {
  const s = mem(seed());
  assert.deepEqual((await searchConversations(s, LAN, "hai chau")).map((h) => h.id), [], "hội thoại của Hải: Lan không thấy");
  assert.deepEqual((await searchConversations(s, LAN, "alo")).map((h) => h.id), ["c:conv:u3"], "chưa nhận: thấy");
  assert.deepEqual(await searchConversations(s, HAI, "xoai"), [], "Hải không có quyền ở kênh");
});

test("danh sách: status=active ẩn hội thoại đã xong; tìm kiếm qua danh sách trả cả đoạn trích", async () => {
  const { listConversations } = await import("../src/core/service");
  const db = seed();
  db.conversations["c:conv:u2"].status = "resolved";
  const s = mem(db);
  assert.deepEqual((await listConversations(s, { status: "active", actor: ADMIN })).map((i) => i.id).sort(), ["c:conv:u1", "c:conv:u3"]);
  assert.deepEqual((await listConversations(s, { status: "resolved", actor: ADMIN })).map((i) => i.id), ["c:conv:u2"]);
  const found = await listConversations(s, { status: "all", q: "hai chau", actor: ADMIN });
  assert.deepEqual(found.map((i) => i.id), ["c:conv:u2"], "tìm thấy cả hội thoại đã xong");
  assert.match(found[0].snippet!, /Hải Châu/);
});

test("máy chủ không có ổ đĩa bền (KPCHAT_EPHEMERAL=1): cảnh báo thường trực cho quản trị", () => {
  const out = buildAlerts({ channels: [], health: {}, webhook: { configured: false }, ephemeral: true });
  assert.deepEqual(out.map((a) => [a.key, a.level]), [["ephemeral", "warn"]]);
  assert.match(out[0].text, /nối lại Page/);
  assert.deepEqual(buildAlerts({ channels: [], health: {}, webhook: { configured: false } }), []);
});
