# KP Chat 2.0: tài liệu vận hành

Dành cho người chạy và trông KP Chat trên máy chủ. Cập nhật 24/11/2026.

## 1. Kiến trúc chạy
- **Một tiến trình Node.js** (Next.js 16, bản `standalone`), đóng gói bằng `Dockerfile`, chạy trên Railway theo `railway.json`.
- **Chỉ một bản chạy (replica = 1).** Kho dữ liệu nằm trong bộ nhớ của tiến trình và ghi xuống tệp `data/chat.json`. Chạy hai bản cùng lúc sẽ ghi đè lẫn nhau và **mất tin**.
- **Ổ đĩa bền** (Railway Volume) gắn vào `/app/data`. Trong đó có: `chat.json` (toàn bộ dữ liệu), `media/` (ảnh), `backups/` (bản sao lưu).
- Ghi dữ liệu an toàn: ghi tệp tạm, `fsync`, rồi đổi tên. Máy chủ tắt giữa chừng thì vẫn còn bản cũ hoặc bản mới nguyên vẹn. Webhook chỉ trả 200 cho Meta **sau khi** tin đã nằm trên đĩa, nên máy chủ tắt đột ngột thì Meta gửi lại tin; tin trùng bị chặn theo mã tin.

## 2. Đưa lên Railway lần đầu
1. Tạo service từ repo, Railway đọc `railway.json` và build bằng `Dockerfile`. Bước build **chạy toàn bộ test**; test hỏng thì không ra bản mới.
2. Thêm **Volume** gắn vào đường dẫn `/app/data`.
3. Đặt biến môi trường (Settings > Variables). **Không** ghi các giá trị này vào mã hay tài liệu:

| Biến | Bắt buộc | Ghi chú |
|---|---|---|
| `KPCHAT_SECRET_KEY` | Có | Khóa mã hóa token kênh và khóa AI (AES-256-GCM). **Mất hoặc đổi khóa thì mọi token đã lưu không giải mã được**: phải nối lại kênh. Cất một bản ở nơi an toàn ngoài máy chủ. |
| `KPCHAT_PUBLIC_URL` | Có | `https://<tên miền>`, không có `/` ở cuối |
| `KPCHAT_ACCESS_KEY` | Có (tới khi có đăng nhập KP Xuxi) | Tối thiểu 16 ký tự. Có `KPCHAT_PUBLIC_URL` mà thiếu khóa này thì mọi trang bị từ chối. |
| `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN` | Có | Ứng dụng Meta "KP Chat" |
| `META_LOGIN_CONFIG_ID` | Không | Facebook Login for Business |
| `ANTHROPIC_API_KEY` | Không | Có thể nhập ở trang Cài đặt thay vì đặt biến |
| `ZALO_APP_ID`, `ZALO_APP_SECRET` | Khi nối Zalo OA | Xem `docs/ZALO-OA-CAC-BUOC.md` |
| `KPCHAT_BACKUP_KEEP` | Không | Số bản sao lưu giữ lại, mặc định 14 |
| `KPCHAT_BACKUP_HOUR` | Không | Giờ sao lưu hằng ngày theo giờ Việt Nam, mặc định 3 |
| `KPCHAT_RESTORE_FROM` | Chỉ khi khôi phục | Xem mục 5 |

4. Gắn tên miền (Settings > Networking > Custom Domain), thêm bản ghi CNAME ở Tenten theo hướng dẫn của Railway.
5. Mở `https://<tên miền>/api/health`: phải trả `{"ok":true}`.
6. Làm theo `docs/KET-NOI-META.md` (phần 1.3 bước 5, phần 2.3 và 2.4) để đặt lại Redirect URI, webhook và nối Page thử.

## 3. Hằng ngày: theo dõi
- **Băng cảnh báo** ở đầu trang (chỉ quản trị thấy) báo các trường hợp sau, kèm nút mở Cài đặt > Kênh:
  - token Page hết hạn hoặc bị thu hồi;
  - Page chưa đăng ký nhận tin;
  - webhook không truy cập được từ Internet;
  - sao lưu lỗi hoặc quá 36 giờ chưa có bản mới.
- **Nhật ký máy chủ** (Railway > Deployments > Logs), lọc theo:
  - `[canh-bao]`: cảnh báo mới xuất hiện (máy chủ tự kiểm mỗi 5 phút, kể cả khi không ai mở trang);
  - `[sao-luu]`: kết quả sao lưu hằng ngày;
  - `[khoi-phuc]`: khôi phục lúc khởi động;
  - `[webhook:facebook]`: tin không khớp kênh nào;
  - `[meta-login]`: chẩn đoán đăng nhập Facebook.
- **Kiểm tra sống**: `/api/health`. Có thể gắn vào dịch vụ theo dõi bên ngoài (UptimeRobot hoặc tương tự) để nhận báo khi máy chủ chết.

## 4. Sự cố thường gặp
| Hiện tượng | Xử lý |
|---|---|
| Cảnh báo "token hết hạn hoặc bị thu hồi" | Cài đặt > Kênh > bấm "Kết nối lại", đăng nhập Facebook bằng tài khoản quản trị Page, chọn lại Page. Lịch sử và phân quyền được giữ. |
| Cảnh báo "webhook không truy cập được" | Kiểm máy chủ và tên miền. Khi đã chạy lại: Cài đặt > Kênh > chi tiết Page > "Khôi phục tin lỡ" (chọn số giờ bị ngắt). Tin lỡ được ghi như tin mới nhưng không đánh thức chatbot. |
| Page chưa đăng ký nhận tin | Chi tiết Page > bước "Đăng ký nhận tin" |
| Máy chủ không bật, nhật ký báo không đọc được kho | Tệp `chat.json` hỏng. Máy chủ **cố ý không chạy tiếp** (tránh ghi đè bằng kho rỗng). Khôi phục bản sao lưu gần nhất (mục 5). |

## 5. Sao lưu và khôi phục
**Tự động**: mỗi ngày sau 3 giờ sáng (giờ Việt Nam), máy chủ tạo một bản sao lưu ở `data/backups/snapshots/<YYYY-MM-DD_HHmm>/`:
- `chat.json.gz` là bản nén của dữ liệu;
- `manifest.json` ghi mã băm, số hội thoại, số tin, danh sách ảnh;
- ảnh nằm ở kho ảnh chung `data/backups/media/` và chỉ chép ảnh mới.

Mỗi bản được **tự kiểm đọc lại** ngay sau khi tạo: giải nén, so mã băm, số tin, đủ ảnh. Hệ thống giữ 14 bản gần nhất.

**Sao lưu ngay**: quản trị gọi `POST /api/backup` (đang mở trang KP Chat thì chạy trong console trình duyệt: `fetch("/api/backup",{method:"POST"}).then(r=>r.json())`). `GET /api/backup` liệt kê các bản.

**Khôi phục trên Railway:**
1. Xem mã bản cần khôi phục: `GET /api/backup`, hoặc nhật ký dòng `[sao-luu] đã tạo ...`.
2. Đặt biến `KPCHAT_RESTORE_FROM=<mã bản>` rồi Redeploy. Lúc khởi động, máy chủ sẽ:
   - kiểm bản sao lưu và chép đè dữ liệu cùng ảnh thiếu;
   - giữ dữ liệu cũ thành `chat.json.before-restore-<thời điểm>`;
   - ghi dấu đã khôi phục, để lần khởi động sau không khôi phục lặp lại.
3. Kiểm nhật ký dòng `[khoi-phuc] ĐÃ KHÔI PHỤC ...`, rồi **xóa biến `KPCHAT_RESTORE_FROM`**.
4. Tin khách nhắn trong khoảng từ lúc sao lưu tới lúc khôi phục: dùng "Khôi phục tin lỡ" ở từng Page (Meta cho lấy lại tin qua API hội thoại).

**Khôi phục trên máy** (bản chạy thử): tắt máy chủ, chạy `npm run restore` để liệt kê các bản, rồi `npm run restore -- <mã bản>`, rồi bật lại. Dùng `npm run restore -- --check <mã>` để chỉ kiểm mà không khôi phục.

**Đã thử khôi phục** (24/11/2026):
- bằng test tự động (`tests/backup.test.ts`): sao lưu, làm hỏng dữ liệu và xóa ảnh, khôi phục, kiểm đủ tin và ảnh, máy chủ đọc lại đúng;
- bằng tay trên bản build production: `KPCHAT_RESTORE_FROM` khôi phục đúng 7 tin của kho thử.

**Quan trọng: bản sao lưu đang nằm CÙNG ổ đĩa với dữ liệu.** Cách này chống được lỗi phần mềm và xóa nhầm, nhưng **không chống được mất ổ hay mất dịch vụ**. Cần thêm một trong các cách sau (cần công ty quyết):
- bật Volume Backups của Railway (nếu gói dịch vụ có);
- định kỳ tải thư mục `data/backups/` về nơi khác;
- thêm bước đẩy bản sao lưu lên kho tệp ngoài (S3, R2, Google Drive). Bước này chưa làm, vì chưa có chỗ lưu và khóa.

## 6. Lùi về bản trước khi bản mới lỗi
1. **Railway > Deployments**: chọn bản đang chạy tốt trước đó > **Redeploy** (hoặc **Rollback**). Volume không đổi nên dữ liệu được giữ.
2. Mỗi lần đưa bản mới lên, gắn **git tag** (ví dụ `v2.0.3`) để biết bản nào đã chạy tốt.
3. **Dữ liệu tương thích ngược**: các thay đổi hiện tại chỉ **thêm** trường vào dữ liệu, không đổi hay xóa trường cũ, nên bản cũ đọc được dữ liệu do bản mới ghi. Nếu sau này có bản đổi cấu trúc dữ liệu, phải ghi rõ trong ghi chú phát hành và **sao lưu ngay trước khi** đưa lên (`POST /api/backup`). Lùi bản khi đó thì khôi phục kèm bản sao lưu đó.
4. Không tự đẩy lên bản chính khi chưa được duyệt (ràng buộc dự án).

## 7. Ràng buộc đã khóa trong mã (`src/core/guardrails.ts`)
- **Chatbot không tự gửi cho khách.** Chỉ có chế độ Soạn nháp, Gợi ý tham khảo và Tắt. Chatbot cũ ở chế độ "Tự trả lời" tự chuyển thành Soạn nháp khi nạp dữ liệu. Lõi gửi tin từ chối mọi tin do máy gửi.
- **Không nối Zalo cá nhân bằng `zca-js`.** Không đăng ký adapter, không đăng nhập lại số nào khi khởi động, API trả 403, mục "Zalo cá nhân" bị ẩn.
- Hai ràng buộc này là hằng số trong mã, **không có biến môi trường để bật lại**. Có test kiểm (`tests/guardrails.test.ts`).

## 8. Build
- Chỉ build bản chạy thật **trong Docker** (Dockerfile). `.dockerignore` loại `data/` và `.env*` khỏi ngữ cảnh build, nên ảnh container không chứa dữ liệu khách hay khóa bí mật.
- **Không** chép thư mục `.next/standalone` build trên máy phát triển đi nơi khác: Next.js có thể gom ảnh trong `data/media` của máy đó vào thư mục này.
