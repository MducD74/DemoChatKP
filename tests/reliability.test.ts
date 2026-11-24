// Yêu cầu 2.4: không mất tin, không trùng tin, kể cả khi máy chủ khởi động lại hoặc nền tảng gửi lại webhook.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { JsonStore, messagesOf, mutate, type DB } from "../src/core/store";
import { registerAdapter, type ChannelAdapter, type SendInput } from "../src/core/adapter";
import { ingest } from "../src/core/ingest";
import { sendReply } from "../src/core/service";
import { DEMO_STAFF } from "../src/core/staff";
import type { InboundEvent } from "../src/core/types";

const [ADMIN] = DEMO_STAFF;
const tmpFile = () => path.join(mkdtempSync(path.join(tmpdir(), "kprel-")), "chat.json");
const ev = (mid: string, dir: "in" | "out", text: string, at: number, attachments: InboundEvent["message"]["attachments"] = []): InboundEvent =>
  ({ channelExternalId: "P", contact: { externalId: "u1" }, message: { externalId: mid, direction: dir, text, attachments, at } });

// Adapter giả kiểu Meta: chữ và từng ảnh là tin riêng, mỗi tin một mã. Có thể cho echo về TRƯỚC khi lời gọi gửi trả về.
let n = 0;
let beforeReturn: ((mids: string[]) => Promise<void>) | null = null;
const fakeMeta: ChannelAdapter = {
  id: "facebook", replyWindowMs: 24 * 3600_000, verify: () => true, parse: (p) => p as InboundEvent[],
  async send(i: SendInput) {
    const parts = [...(i.text ? [{ externalId: `mid.${++n}`, text: i.text }] : []), ...(i.attachments ?? []).map((a) => ({ externalId: `mid.${++n}`, attachment: a }))];
    if (beforeReturn) await beforeReturn(parts.map((p) => p.externalId));
    return { ok: true, externalId: parts.at(-1)?.externalId, ...(parts.length > 1 ? { parts } : {}) };
  },
};
registerAdapter(fakeMeta);

async function seed(store: JsonStore) {
  await mutate(store, (db) => {
    db.channels.c = { id: "c", companyId: "x", kind: "facebook", externalId: "P", name: "Page thử", sendEnabled: true };
  });
  await ingest(store, "facebook", [ev("m.in1", "in", "Hộp trái cây giá bao nhiêu?", Date.now() - 5000)]);
}

test("khởi động lại: kho mới đọc lại đúng mọi tin đã ghi (tin đã trả 200 cho webhook là đã nằm trên đĩa)", async () => {
  const file = tmpFile();
  const a = new JsonStore(file);
  await seed(a);
  await Promise.all(Array.from({ length: 30 }, (_, i) => ingest(a, "facebook", [ev(`m.${i}`, "in", `tin ${i}`, Date.now() + i)])));
  // Không gọi flush: mỗi ingest chỉ trả về khi đã ghi xong, nên "máy chủ tắt" ngay lúc này vẫn đủ dữ liệu
  const b = new JsonStore(file);
  const db = await b.load();
  assert.equal(Object.keys(db.messages).length, 31);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).messages["c:m.29"].text, "tin 29");
});

test("nền tảng gửi lại webhook (cùng mã tin), kể cả sau khi khởi động lại: không trùng", async () => {
  const file = tmpFile();
  const a = new JsonStore(file);
  await seed(a);
  const again = await ingest(a, "facebook", [ev("m.in1", "in", "Hộp trái cây giá bao nhiêu?", Date.now() - 5000)]);
  assert.equal(again.duplicates, 1);
  const b = new JsonStore(file);
  const r = await ingest(b, "facebook", [ev("m.in1", "in", "Hộp trái cây giá bao nhiêu?", Date.now() - 5000)]);
  assert.deepEqual([r.stored, r.duplicates], [0, 1]);
  assert.equal(Object.keys((await b.load()).messages).length, 1);
});

test("trả lời từ KP Chat: echo về sau thì bị chặn trùng; tin mang tên nhân viên", async () => {
  const s = new JsonStore(tmpFile());
  await seed(s);
  beforeReturn = null;
  assert.equal((await sendReply(s, "c:conv:u1", { text: "Dạ 45.000đ ạ" }, ADMIN)).ok, true);
  const mid = `mid.${n}`;
  const r = await ingest(s, "facebook", [ev(mid, "out", "Dạ 45.000đ ạ", Date.now())]);
  assert.equal(r.duplicates, 1);
  const out = messagesOf(await s.load(), "c:conv:u1").filter((m) => m.direction === "out");
  assert.equal(out.length, 1);
  assert.equal(out[0].senderUid, ADMIN.uid);
});

test("echo về TRƯỚC khi lời gọi gửi trả về: không tạo bản thứ hai", async () => {
  const s = new JsonStore(tmpFile());
  await seed(s);
  beforeReturn = async (mids) => { await ingest(s, "facebook", mids.map((m) => ev(m, "out", "Dạ 45.000đ ạ", Date.now()))); };
  assert.equal((await sendReply(s, "c:conv:u1", { text: "Dạ 45.000đ ạ" }, ADMIN)).ok, true);
  beforeReturn = null;
  const out = messagesOf(await s.load(), "c:conv:u1").filter((m) => m.direction === "out");
  assert.equal(out.length, 1);
  assert.equal(out[0].senderUid, ADMIN.uid, "tin echo được gắn tên nhân viên đã gửi");
});

test("gửi chữ kèm 2 ảnh: lưu 3 tin với đúng mã; echo của cả 3 không làm trùng", async () => {
  const s = new JsonStore(tmpFile());
  await seed(s);
  const imgs = [{ type: "image" as const, url: "https://x/api/media/a.png" }, { type: "image" as const, url: "https://x/api/media/b.png" }];
  assert.equal((await sendReply(s, "c:conv:u1", { text: "Dạ ảnh hộp trái cây ạ", attachments: imgs }, ADMIN)).ok, true);
  const mids = [n - 2, n - 1, n].map((k) => `mid.${k}`);
  const r = await ingest(s, "facebook", [ev(mids[0], "out", "Dạ ảnh hộp trái cây ạ", Date.now()), ev(mids[1], "out", "", Date.now(), [imgs[0]]), ev(mids[2], "out", "", Date.now(), [imgs[1]])]);
  assert.equal(r.duplicates, 3);
  const out = messagesOf(await s.load(), "c:conv:u1").filter((m) => m.direction === "out");
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((m) => m.externalId), mids);
});

test("tệp dữ liệu hỏng: báo lỗi chứ không trả kho rỗng (tránh ghi đè mất dữ liệu)", async () => {
  const file = tmpFile();
  writeFileSync(file, "{ hỏng");
  await assert.rejects(new JsonStore(file).load());
});

test("chỉ mục tin theo hội thoại cập nhật khi có tin mới", async () => {
  const s = new JsonStore(tmpFile());
  await seed(s);
  const db1: DB = await s.load();
  assert.equal(messagesOf(db1, "c:conv:u1").length, 1);
  await ingest(s, "facebook", [ev("m.in2", "in", "Còn hàng không?", Date.now())]);
  assert.equal(messagesOf(await s.load(), "c:conv:u1").length, 2);
});
