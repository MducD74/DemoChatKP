// Phần chạy trên Node.js của instrumentation.ts, trước khi máy chủ nhận yêu cầu.
// 1. Khôi phục theo yêu cầu: đặt KPCHAT_RESTORE_FROM=<mã bản sao lưu> rồi khởi động lại (dùng trên Railway, nơi không chạy được
//    npm run restore). Đã khôi phục bản nào thì ghi dấu, khởi động lại lần sau không khôi phục lặp; xong thì xoá biến này.
// 2. Khởi động việc nền (sao lưu hằng ngày, kiểm tra cảnh báo) để chạy cả khi chưa ai mở trang.
import { promises as fs } from "node:fs";
import path from "node:path";
import { defaultPaths, restoreBackup } from "@/core/backup";

async function restoreIfAsked() {
  const id = process.env.KPCHAT_RESTORE_FROM?.trim();
  if (!id) return;
  const p = defaultPaths();
  const mark = path.join(path.dirname(p.dataFile), `.restored-${id.replace(/[^\w-]/g, "_")}`);
  if (await fs.access(/*turbopackIgnore: true*/ mark).then(() => true, () => false)) return console.info(`[khoi-phuc] bản ${id} đã khôi phục trước đây, bỏ qua. Xoá biến KPCHAT_RESTORE_FROM.`);
  const r = await restoreBackup(p, id); // lỗi thì máy chủ không bật (không chạy tiếp với dữ liệu sai)
  await fs.writeFile(/*turbopackIgnore: true*/ mark, new Date().toISOString());
  console.warn(`[khoi-phuc] ĐÃ KHÔI PHỤC bản ${id}: ${r.manifest.counts.messages} tin, chép lại ${r.mediaCopied} ảnh. Bản trước giữ ở ${r.kept ?? "(không có)"}. Xoá biến KPCHAT_RESTORE_FROM.`);
}

export async function start() {
  await restoreIfAsked();
  if (process.env.NODE_ENV === "production") (await import("@/server")).boot();
}
