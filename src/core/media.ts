// Ảnh nhân viên tải lên để gửi cho khách. Lưu file local, đặt tên bằng mã ngẫu nhiên khó đoán.
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

const DIR = () => process.env.KPCHAT_MEDIA_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "media");
export const MAX_UPLOAD = 3 * 1024 * 1024; // 3MB (giới hạn ảnh của TikTok; Zalo chỉ 1MB)
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png" };
const MIME: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
export const MAX_VISITOR_IMAGE = 5 * 1024 * 1024; // ảnh khách gửi từ khung chat web

export async function saveUpload(bytes: Uint8Array, mime: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ext = TYPES[mime];
  if (!ext) return { ok: false, error: "Chỉ nhận ảnh jpg hoặc png" };
  if (bytes.byteLength > MAX_UPLOAD) return { ok: false, error: "Ảnh lớn hơn 3MB" };
  if (bytes.byteLength === 0) return { ok: false, error: "Tệp rỗng" };
  const id = randomBytes(16).toString("hex") + "." + ext;
  await fs.mkdir(/*turbopackIgnore: true*/ DIR(), { recursive: true });
  await fs.writeFile(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ DIR(), id), bytes);
  return { ok: true, id };
}

export async function readUpload(id: string): Promise<{ bytes: Buffer; mime: string } | null> {
  const m = /^[0-9a-f]{32}\.(jpg|png|webp)$/.exec(id); // chặn đường dẫn lạ
  if (!m) return null;
  try {
    return { bytes: await fs.readFile(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ DIR(), id)), mime: MIME[m[1]] };
  } catch {
    return null;
  }
}

export async function deleteUpload(file: string): Promise<void> {
  if (!/^[0-9a-f]{32}\.(jpg|png|webp)$/.test(file)) return;
  await fs.rm(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ DIR(), file), { force: true });
}

// Nhận dạng định dạng ảnh theo nội dung thật của tệp (không tin loại tệp khách khai): jpg, png, webp.
export function sniffImage(b: Uint8Array): "jpg" | "png" | "webp" | null {
  if (b.length > 11 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length > 11 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return "png";
  const tag = (o: number, t: string) => [...t].every((c, i) => b[o + i] === c.charCodeAt(0));
  if (b.length > 11 && tag(0, "RIFF") && tag(8, "WEBP")) return "webp";
  return null;
}

// Ảnh khách tải lên từ khung chat web: jpg, png hoặc webp, tối đa 5MB. Cùng thư mục và cách đặt tên với ảnh nhân viên.
export async function saveVisitorImage(bytes: Uint8Array): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (bytes.byteLength === 0) return { ok: false, error: "Tệp rỗng" };
  if (bytes.byteLength > MAX_VISITOR_IMAGE) return { ok: false, error: "Ảnh lớn hơn 5MB" };
  const ext = sniffImage(bytes);
  if (!ext) return { ok: false, error: "Chỉ nhận ảnh jpg, png hoặc webp" };
  const id = randomBytes(16).toString("hex") + "." + ext;
  await fs.mkdir(/*turbopackIgnore: true*/ DIR(), { recursive: true });
  await fs.writeFile(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ DIR(), id), bytes);
  return { ok: true, id };
}

export async function uploadExists(id: string): Promise<boolean> {
  if (!/^[0-9a-f]{32}\.(jpg|png|webp)$/.test(id)) return false;
  return fs.stat(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ DIR(), id)).then((st) => st.isFile(), () => false);
}
