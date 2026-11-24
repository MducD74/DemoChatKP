// Thư viện ảnh (thư mục ảnh) và mẫu trả lời nhiều nội dung, như thư viện mẫu của KP Chat 1.1.
import { mutate, type MediaItem, type QuickBlock, type Store, type Template } from "./store";
import { deleteUpload, saveUpload } from "./media";

const MAX_BLOCKS = 6, MAX_IMAGES = 10, MAX_TEXT = 2000, MAX_FOLDER = 40;
const KEY_RE = /^[a-z0-9_-]{1,20}$/;
type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const lib = (db: { library?: { folders: string[]; items: Record<string, MediaItem> } }) => (db.library ??= { folders: [], items: {} });

// ---------- Ảnh ----------
export async function listLibrary(store: Store, base: string) {
  const l = (await store.load()).library ?? { folders: [], items: {} };
  const items = Object.values(l.items).sort((a, b) => b.at - a.at).map((m) => ({ ...m, url: `${base}/api/media/${m.file}` }));
  return { folders: [...l.folders].sort((a, b) => a.localeCompare(b)), items };
}

export async function uploadToLibrary(store: Store, input: { bytes: Uint8Array; mime: string; name: string; folder?: string }): Promise<Res<{ item: MediaItem }>> {
  const folder = input.folder?.trim() || undefined;
  if (folder) {
    const l = (await store.load()).library;
    if (!l?.folders.includes(folder)) return { ok: false, error: "Thư mục không tồn tại" };
  }
  const saved = await saveUpload(input.bytes, input.mime);
  if (!saved.ok) return saved;
  const id = saved.id.replace(/\.(jpg|png)$/, "");
  const item: MediaItem = { id, file: saved.id, name: input.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 80) || "Ảnh", folder, size: input.bytes.byteLength, at: Date.now() };
  await mutate(store, (db) => { lib(db).items[id] = item; });
  return { ok: true, item };
}

export async function updateMedia(store: Store, id: string, patch: { name?: string; folder?: string | null; fav?: boolean }): Promise<Res> {
  return mutate(store, (db): Res => {
    const l = lib(db), m = l.items[id];
    if (!m) return { ok: false, error: "Không thấy ảnh" };
    if (patch.folder) {
      if (!l.folders.includes(patch.folder)) return { ok: false, error: "Thư mục không tồn tại" };
      m.folder = patch.folder;
    } else if (patch.folder === null) m.folder = undefined;
    if (patch.name !== undefined) {
      const n = patch.name.trim().slice(0, 80);
      if (!n) return { ok: false, error: "Tên ảnh không được trống" };
      m.name = n;
    }
    if (patch.fav !== undefined) m.fav = patch.fav;
    return { ok: true };
  });
}

export async function deleteMedia(store: Store, id: string): Promise<Res> {
  const file = await mutate(store, (db) => {
    const l = lib(db), m = l.items[id];
    if (!m) return null;
    delete l.items[id];
    // gỡ ảnh khỏi các mẫu đang dùng; nội dung chỉ có ảnh mà hết ảnh thì bỏ luôn nội dung đó
    for (const t of Object.values(db.templates ?? {})) {
      t.blocks = t.blocks.map((b) => ({ ...b, images: b.images.filter((x) => x !== id) })).filter((b) => b.text.trim() || b.images.length);
    }
    return m.file;
  });
  if (!file) return { ok: false, error: "Không thấy ảnh" };
  await deleteUpload(file);
  return { ok: true };
}

export async function createFolder(store: Store, name: string): Promise<Res> {
  const n = name.trim();
  if (!n || n.length > MAX_FOLDER) return { ok: false, error: `Tên thư mục từ 1 đến ${MAX_FOLDER} ký tự` };
  return mutate(store, (db): Res => {
    const l = lib(db);
    if (l.folders.some((f) => f.toLowerCase() === n.toLowerCase())) return { ok: false, error: "Thư mục đã có" };
    l.folders.push(n);
    return { ok: true };
  });
}

export async function renameFolder(store: Store, from: string, to: string): Promise<Res> {
  const n = to.trim();
  if (!n || n.length > MAX_FOLDER) return { ok: false, error: `Tên thư mục từ 1 đến ${MAX_FOLDER} ký tự` };
  return mutate(store, (db): Res => {
    const l = lib(db);
    const i = l.folders.indexOf(from);
    if (i < 0) return { ok: false, error: "Không thấy thư mục" };
    if (l.folders.some((f, j) => j !== i && f.toLowerCase() === n.toLowerCase())) return { ok: false, error: "Tên thư mục đã có" };
    l.folders[i] = n;
    for (const m of Object.values(l.items)) if (m.folder === from) m.folder = n;
    return { ok: true };
  });
}

// Xóa thư mục: ảnh trong đó không bị xóa, chuyển về "chưa phân thư mục".
export async function deleteFolder(store: Store, name: string): Promise<Res> {
  return mutate(store, (db): Res => {
    const l = lib(db);
    if (!l.folders.includes(name)) return { ok: false, error: "Không thấy thư mục" };
    l.folders = l.folders.filter((f) => f !== name);
    for (const m of Object.values(l.items)) if (m.folder === name) m.folder = undefined;
    return { ok: true };
  });
}

// ---------- Mẫu trả lời ----------
export async function listTemplates(store: Store): Promise<Template[]> {
  return Object.values((await store.load()).templates ?? {}).sort((a, b) => a.order - b.order);
}

function cleanBlocks(blocks: QuickBlock[], known: Set<string>): Res<{ blocks: QuickBlock[] }> {
  if (!Array.isArray(blocks) || blocks.length === 0) return { ok: false, error: "Cần ít nhất một nội dung" };
  if (blocks.length > MAX_BLOCKS) return { ok: false, error: `Tối đa ${MAX_BLOCKS} nội dung mỗi mẫu` };
  const out: QuickBlock[] = [];
  for (const b of blocks) {
    const text = String(b?.text ?? "").trim();
    const images = [...new Set((b?.images ?? []).map(String))];
    if (text.length > MAX_TEXT) return { ok: false, error: `Mỗi nội dung tối đa ${MAX_TEXT} ký tự` };
    if (images.length > MAX_IMAGES) return { ok: false, error: `Mỗi nội dung tối đa ${MAX_IMAGES} ảnh` };
    if (images.some((i) => !known.has(i))) return { ok: false, error: "Có ảnh không còn trong thư viện" };
    if (!text && !images.length) return { ok: false, error: "Mỗi nội dung cần có chữ hoặc ảnh" };
    out.push({ text, images });
  }
  return { ok: true, blocks: out };
}

export async function saveTemplate(store: Store, t: { id?: string; key: string; blocks: QuickBlock[] }): Promise<Res<{ template: Template }>> {
  const key = String(t.key ?? "").trim().replace(/^\//, "").toLowerCase();
  if (!KEY_RE.test(key)) return { ok: false, error: "Ký tự tắt gồm chữ không dấu, số, - và _ (tối đa 20 ký tự)" };
  return mutate(store, (db): Res<{ template: Template }> => {
    const all = (db.templates ??= {});
    const cb = cleanBlocks(t.blocks, new Set(Object.keys(lib(db).items)));
    if (!cb.ok) return cb;
    if (Object.values(all).some((x) => x.key === key && x.id !== t.id)) return { ok: false, error: "Ký tự tắt đã dùng cho mẫu khác" };
    const exist = t.id ? all[t.id] : undefined;
    const id = exist?.id ?? `tpl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const order = exist?.order ?? Math.max(0, ...Object.values(all).map((x) => x.order)) + 1;
    all[id] = { id, key, blocks: cb.blocks, order };
    return { ok: true, template: all[id] };
  });
}

export async function moveTemplate(store: Store, id: string, dir: -1 | 1): Promise<boolean> {
  return mutate(store, (db) => {
    const list = Object.values(db.templates ?? {}).sort((a, b) => a.order - b.order);
    const i = list.findIndex((x) => x.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return false;
    [list[i].order, list[j].order] = [list[j].order, list[i].order];
    return true;
  });
}

export async function deleteTemplate(store: Store, id: string): Promise<boolean> {
  return mutate(store, (db) => {
    if (!db.templates?.[id]) return false;
    delete db.templates[id];
    return true;
  });
}

export const VARS: [string, string][] = [["ten_khach", "Tên khách"], ["ten_nhan_vien", "Tên nhân viên"]];
// Thay biến trong mẫu: {ten_khach}, {ten_nhan_vien}. Biến lạ giữ nguyên.
export function renderTemplate(body: string, vars: { ten_khach?: string; ten_nhan_vien?: string }) {
  return body.replace(/\{(ten_khach|ten_nhan_vien)\}/g, (m, k: "ten_khach" | "ten_nhan_vien") => vars[k] ?? m);
}
