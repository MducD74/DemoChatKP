// Khôi phục từ bản sao lưu. PHẢI TẮT máy chủ KP Chat trước (máy chủ giữ dữ liệu trong bộ nhớ và sẽ ghi đè bản vừa khôi phục).
//   npm run restore                 liệt kê các bản sao lưu
//   npm run restore -- <mã bản>     khôi phục bản đó (bản hiện tại được giữ lại thành chat.json.before-restore-...)
//   npm run restore -- --check <mã> chỉ kiểm bản đó đọc lại được, không khôi phục
import { defaultPaths, listBackups, restoreBackup, verifyBackup } from "../src/core/backup";

const p = defaultPaths();
const args = process.argv.slice(2);
const vn = (t: number) => new Date(t).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

async function main() {
  if (!args.length) {
    const all = await listBackups(p);
    if (!all.length) return console.log(`Chưa có bản sao lưu nào trong ${p.backupDir}`);
    for (const m of all) console.log(`${m.id}  ${vn(m.at)}  ${m.counts.conversations} hội thoại, ${m.counts.messages} tin, ${m.media.length} ảnh`);
    return;
  }
  if (args[0] === "--check") {
    const v = await verifyBackup(p, args[1] ?? "");
    if (!v.ok) throw new Error(v.error);
    return console.log(`Bản ${args[1]} tốt: ${v.manifest.counts.messages} tin, ${v.manifest.media.length} ảnh.`);
  }
  const r = await restoreBackup(p, args[0]);
  console.log(`Đã khôi phục ${r.manifest.id} (${vn(r.manifest.at)}) vào ${p.dataFile}; chép lại ${r.mediaCopied} ảnh.`);
  if (r.kept) console.log(`Dữ liệu trước khi khôi phục được giữ ở ${r.kept}.`);
  console.log("Bật lại máy chủ KP Chat.");
}
main().catch((e) => { console.error("LỖI:", e instanceof Error ? e.message : e); process.exit(1); });
