// Sao lưu dữ liệu và ảnh ngay (ngoài lịch hằng ngày của máy chủ). Dùng: npm run backup
// Đọc tệp dữ liệu trên đĩa (máy chủ ghi tệp nguyên tử nên đọc lúc máy chủ đang chạy vẫn an toàn).
import { createBackup, defaultPaths } from "../src/core/backup";

const p = defaultPaths();
createBackup(p).then((m) => {
  console.log(`Đã sao lưu ${m.id} vào ${p.backupDir}: ${m.counts.conversations} hội thoại, ${m.counts.messages} tin, ${m.media.length} ảnh (đã tự kiểm đọc lại được).`);
}).catch((e) => { console.error("Sao lưu LỖI:", e instanceof Error ? e.message : e); process.exit(1); });
