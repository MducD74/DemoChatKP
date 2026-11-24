// Chuẩn bị ảnh gửi qua Zalo cá nhân: lấy byte từ ảnh đã tải lên KP Chat (không tải địa chỉ ngoài) và đo kích thước jpg/png.
import { readUpload } from "./media";
import type { ZSource } from "./zalopersonal";

// Đọc kích thước từ phần đầu tệp, không cần thư viện ảnh
export function imageSize(b: Buffer): { width: number; height: number } | null {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }; // PNG: khối IHDR
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) }; // khối SOFn
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

// url có dạng <địa chỉ KP Chat>/api/media/<mã>.jpg|png (cổng gửi đã chặn địa chỉ lạ; ở đây chỉ lấy mã và đọc tệp trong thư mục tải lên)
export async function loadImageForZalo(url: string): Promise<{ ok: true; src: ZSource } | { ok: false; error: string }> {
  let id = "";
  try { id = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? ""); } catch { /* url hỏng */ }
  const f = id ? await readUpload(id) : null;
  if (!f) return { ok: false, error: "Không đọc được ảnh đã tải lên, hãy chọn lại ảnh" };
  const dim = imageSize(f.bytes);
  if (!dim || !dim.width || !dim.height) return { ok: false, error: "Không đọc được kích thước ảnh" };
  return { ok: true, src: { data: f.bytes, filename: id as `${string}.${string}`, metadata: { totalSize: f.bytes.byteLength, width: dim.width, height: dim.height } } };
}
