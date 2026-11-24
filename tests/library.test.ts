import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DB, Store } from "../src/core/store";
import {
  createFolder, deleteFolder, deleteMedia, deleteTemplate, listLibrary, listTemplates, moveTemplate,
  renameFolder, renderTemplate, saveTemplate, updateMedia, uploadToLibrary,
} from "../src/core/library";

process.env.KPCHAT_MEDIA_DIR = mkdtempSync(path.join(tmpdir(), "kplib-"));
const mem = () => {
  const s = { db: { channels: {}, contacts: {}, conversations: {}, messages: {} } as DB,
    async load() { return structuredClone(s.db); }, async save(d: DB) { s.db = d; } };
  return s as Store & { db: DB };
};
const png = (n = 3) => ({ bytes: new Uint8Array(n).fill(7), mime: "image/png", name: "Bảng giá.png" });
const must = <T extends { ok: boolean }>(r: T) => { assert.equal(r.ok, true, JSON.stringify(r)); return r as Extract<T, { ok: true }>; };

test("thư mục: tạo, trùng tên, đổi tên (ảnh theo sang tên mới), xóa (ảnh về chưa phân)", async () => {
  const s = mem();
  must(await createFolder(s, "Menu"));
  assert.equal((await createFolder(s, "menu")).ok, false); // trùng, không phân biệt hoa thường
  assert.equal((await createFolder(s, "  ")).ok, false);
  const a = must(await uploadToLibrary(s, { ...png(), folder: "Menu" }));
  assert.equal(a.item.folder, "Menu");
  must(await renameFolder(s, "Menu", "Thực đơn"));
  assert.equal(s.db.library!.items[a.item.id].folder, "Thực đơn");
  assert.equal((await renameFolder(s, "khong-co", "X")).ok, false);
  must(await deleteFolder(s, "Thực đơn"));
  assert.equal(s.db.library!.items[a.item.id].folder, undefined);
  assert.equal(s.db.library!.folders.length, 0);
});

test("ảnh: tải lên (tên bỏ đuôi, thư mục phải có), đổi tên, yêu thích, chuyển thư mục, xóa", async () => {
  const s = mem();
  assert.equal((await uploadToLibrary(s, { ...png(), folder: "Không có" })).ok, false);
  assert.equal((await uploadToLibrary(s, { bytes: new Uint8Array([1]), mime: "image/gif", name: "a.gif" })).ok, false);
  const a = must(await uploadToLibrary(s, png()));
  assert.equal(a.item.name, "Bảng giá");
  assert.ok(existsSync(path.join(process.env.KPCHAT_MEDIA_DIR!, a.item.file)));
  must(await updateMedia(s, a.item.id, { fav: true, name: "Giá Tết" }));
  must(await createFolder(s, "Giá"));
  must(await updateMedia(s, a.item.id, { folder: "Giá" }));
  assert.equal((await updateMedia(s, a.item.id, { folder: "Không có" })).ok, false);
  assert.equal((await updateMedia(s, a.item.id, { name: " " })).ok, false);
  must(await updateMedia(s, a.item.id, { folder: null }));
  const l = await listLibrary(s, "http://x");
  assert.equal(l.items[0].url, `http://x/api/media/${a.item.file}`);
  assert.equal(l.items[0].fav, true);
  must(await deleteMedia(s, a.item.id));
  assert.equal(existsSync(path.join(process.env.KPCHAT_MEDIA_DIR!, a.item.file)), false); // tệp thật cũng bị xóa
  assert.equal((await deleteMedia(s, a.item.id)).ok, false);
});

test("mẫu nhiều nội dung: kiểm ký tự tắt, số nội dung và ảnh, ảnh phải có trong thư viện, trùng ký tự tắt", async () => {
  const s = mem();
  const img = must(await uploadToLibrary(s, png()));
  const b = (text: string, images: string[] = []) => ({ text, images });
  assert.equal((await saveTemplate(s, { key: "Có Dấu", blocks: [b("x")] })).ok, false);
  assert.equal((await saveTemplate(s, { key: "a", blocks: [] })).ok, false);
  assert.equal((await saveTemplate(s, { key: "a", blocks: [b("")] })).ok, false); // trống
  assert.equal((await saveTemplate(s, { key: "a", blocks: Array.from({ length: 7 }, () => b("x")) })).ok, false);
  assert.equal((await saveTemplate(s, { key: "a", blocks: [b("x", ["khong-co"])] })).ok, false);
  assert.equal((await saveTemplate(s, { key: "a", blocks: [b("x", Array(6).fill(img.item.id).map((x, i) => x + i))] })).ok, false);
  const t = must(await saveTemplate(s, { key: "/Gia", blocks: [b("Giá {ten_khach}", [img.item.id]), b("Cảm ơn")] }));
  assert.equal(t.template.key, "gia");
  assert.equal(t.template.blocks.length, 2);
  assert.equal((await saveTemplate(s, { key: "gia", blocks: [b("khác")] })).ok, false); // trùng
  must(await saveTemplate(s, { id: t.template.id, key: "gia", blocks: [b("Mới")] })); // sửa chính nó được
  assert.equal((await listTemplates(s)).length, 1);
  assert.equal(renderTemplate("Chào {ten_khach}, {la}", { ten_khach: "Lan" }), "Chào Lan, {la}");
});

test("sắp xếp mẫu lên xuống; xóa mẫu", async () => {
  const s = mem();
  const mk = async (k: string) => must(await saveTemplate(s, { key: k, blocks: [{ text: k, images: [] }] })).template.id;
  const [a, b, c] = [await mk("a"), await mk("b"), await mk("c")];
  assert.deepEqual((await listTemplates(s)).map((t) => t.key), ["a", "b", "c"]);
  assert.equal(await moveTemplate(s, c, -1), true);
  assert.deepEqual((await listTemplates(s)).map((t) => t.key), ["a", "c", "b"]);
  assert.equal(await moveTemplate(s, a, -1), false); // đã ở đầu
  assert.equal(await moveTemplate(s, b, 1), false); // đã ở cuối
  assert.equal(await deleteTemplate(s, c), true);
  assert.equal(await deleteTemplate(s, "khong-co"), false);
});

test("xóa ảnh: gỡ khỏi mẫu đang dùng; nội dung chỉ có ảnh mà hết ảnh thì bỏ luôn", async () => {
  const s = mem();
  const x = must(await uploadToLibrary(s, png())), y = must(await uploadToLibrary(s, png(4)));
  const t = must(await saveTemplate(s, { key: "m", blocks: [{ text: "Chào", images: [x.item.id, y.item.id] }, { text: "", images: [x.item.id] }] })).template;
  must(await deleteMedia(s, x.item.id));
  const after = (await listTemplates(s)).find((q) => q.id === t.id)!;
  assert.equal(after.blocks.length, 1); // nội dung chỉ có ảnh x đã bị bỏ
  assert.deepEqual(after.blocks[0].images, [y.item.id]);
});

test("mẫu: mỗi nội dung có tối đa 10 ảnh (như giới hạn đính kèm khi gửi), 11 ảnh thì từ chối", async () => {
  const s = mem();
  const ids: string[] = [];
  for (let i = 0; i < 11; i++) ids.push(must(await uploadToLibrary(s, { ...png(), name: `a${i}.png` })).item.id);
  must(await saveTemplate(s, { key: "muoi", blocks: [{ text: "10 ảnh", images: ids.slice(0, 10) }] }));
  const r = await saveTemplate(s, { key: "muoimot", blocks: [{ text: "11 ảnh", images: ids }] });
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /tối đa 10 ảnh/);
});
