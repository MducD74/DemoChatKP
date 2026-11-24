// Yêu cầu 6.1: sao lưu dữ liệu và ảnh, đã thử khôi phục được.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { createBackup, listBackups, restoreBackup, verifyBackup, type BackupPaths } from "../src/core/backup";
import { buildAlerts } from "../src/core/alerts";
import { JsonStore, mutate } from "../src/core/store";

const IMG = (n: number) => `${n.toString(16).padStart(32, "0")}.png`;
function setup(): BackupPaths {
  const root = mkdtempSync(path.join(tmpdir(), "kpbak-"));
  const p = { dataFile: path.join(root, "data", "chat.json"), mediaDir: path.join(root, "data", "media"), backupDir: path.join(root, "backups") };
  mkdirSync(p.mediaDir, { recursive: true });
  return p;
}
const db = (n: number) => ({ channels: { c: { id: "c" } }, contacts: {}, conversations: { k: { id: "k" } }, messages: Object.fromEntries(Array.from({ length: n }, (_, i) => [`m${i}`, { id: `m${i}`, conversationId: "k", text: `tin ${i}` }])) });

test("sao lưu rồi khôi phục: dữ liệu và ảnh trở lại đúng như lúc sao lưu; bản trước khi khôi phục được giữ lại", async () => {
  const p = setup();
  writeFileSync(p.dataFile, JSON.stringify(db(3)));
  writeFileSync(path.join(p.mediaDir, IMG(1)), "anh1");
  writeFileSync(path.join(p.mediaDir, "khong-phai-anh.txt"), "x");
  const m = await createBackup(p, { now: Date.UTC(2026, 10, 24, 20, 0) });
  assert.equal(m.id, "2026-11-25_0300", "tên theo giờ Việt Nam");
  assert.deepEqual(m.media, [IMG(1)]);
  assert.equal(m.counts.messages, 3);

  // Sự cố: dữ liệu bị ghi hỏng, mất ảnh
  writeFileSync(p.dataFile, JSON.stringify(db(0)));
  const { rmSync } = await import("node:fs");
  rmSync(path.join(p.mediaDir, IMG(1)));
  const r = await restoreBackup(p, m.id, { now: Date.UTC(2026, 10, 25, 2, 0) });
  assert.equal(r.mediaCopied, 1);
  assert.equal(Object.keys(JSON.parse(readFileSync(p.dataFile, "utf8")).messages).length, 3);
  assert.equal(readFileSync(path.join(p.mediaDir, IMG(1)), "utf8"), "anh1");
  assert.ok(r.kept && existsSync(r.kept), "giữ bản trước khi khôi phục");
  assert.equal(Object.keys(JSON.parse(readFileSync(r.kept!, "utf8")).messages).length, 0);
  // Máy chủ bật lại đọc đúng dữ liệu đã khôi phục
  assert.equal(Object.keys((await new JsonStore(p.dataFile).load()).messages).length, 3);
});

test("ảnh chỉ chép một lần vào kho ảnh chung; giữ N bản mới nhất, ảnh không còn bản nào dùng thì xoá", async () => {
  const p = setup();
  writeFileSync(p.dataFile, JSON.stringify(db(1)));
  writeFileSync(path.join(p.mediaDir, IMG(1)), "a");
  const t0 = Date.UTC(2026, 10, 20);
  await createBackup(p, { now: t0, keep: 2 });
  const { rmSync } = await import("node:fs");
  rmSync(path.join(p.mediaDir, IMG(1))); // ảnh 1 bị xoá khỏi thư viện
  writeFileSync(path.join(p.mediaDir, IMG(2)), "b");
  await createBackup(p, { now: t0 + 86400_000, keep: 2 });
  assert.deepEqual(readdirSync(path.join(p.backupDir, "media")).sort(), [IMG(1), IMG(2)]);
  await createBackup(p, { now: t0 + 2 * 86400_000, keep: 2 });
  const all = await listBackups(p);
  assert.equal(all.length, 2, "chỉ giữ 2 bản");
  assert.deepEqual(readdirSync(path.join(p.backupDir, "media")), [IMG(2)], "ảnh 1 không còn bản nào dùng");
  for (const m of all) assert.equal((await verifyBackup(p, m.id)).ok, true);
});

test("phát hiện bản sao lưu hỏng; không sao lưu tệp dữ liệu hỏng", async () => {
  const p = setup();
  writeFileSync(p.dataFile, JSON.stringify(db(2)));
  const m = await createBackup(p);
  writeFileSync(path.join(p.backupDir, "snapshots", m.id, "chat.json.gz"), gzipSync("{}"));
  const v = await verifyBackup(p, m.id);
  assert.equal(v.ok, false);
  await assert.rejects(restoreBackup(p, m.id), /Không khôi phục được/);
  writeFileSync(p.dataFile, "{ hỏng");
  await assert.rejects(createBackup(p));
});

test("sao lưu từ kho đang chạy (snapshot) có đủ tin vừa ghi", async () => {
  const p = setup();
  const s = new JsonStore(p.dataFile);
  await mutate(s, (d) => { d.channels.c = { id: "c", companyId: "x", kind: "facebook", externalId: "P", name: "P", sendEnabled: false }; });
  const m = await createBackup(p, { text: await s.snapshot() });
  assert.equal(m.counts.channels, 1);
});

test("cảnh báo sao lưu: lỗi, quá 36 giờ, chưa có bản nào; tắt sao lưu thì không báo", () => {
  const base = { channels: [], health: {}, webhook: { configured: false } };
  const now = Date.UTC(2026, 10, 24);
  assert.equal(buildAlerts({ ...base, backup: { enabled: true, error: "hết chỗ" }, now })[0].level, "error");
  assert.match(buildAlerts({ ...base, backup: { enabled: true, lastAt: now - 40 * 3600_000 }, now })[0].text, /36 giờ/);
  assert.match(buildAlerts({ ...base, backup: { enabled: true }, now })[0].text, /Chưa có bản sao lưu/);
  assert.deepEqual(buildAlerts({ ...base, backup: { enabled: true, lastAt: now - 3600_000 }, now }), []);
  assert.deepEqual(buildAlerts({ ...base, backup: { enabled: false }, now }), []);
});
