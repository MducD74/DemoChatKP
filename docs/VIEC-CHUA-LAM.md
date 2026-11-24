# Việc đã biết nhưng chưa làm

Cập nhật 24/11/2026. Xếp theo mục của tài liệu yêu cầu công việc (Xuxi Fruit).

## Đang tạm bỏ qua theo chỉ đạo
- **1.1 Tên miền HTTPS cố định**: đã chuẩn bị `Dockerfile`, `railway.json`, `/api/health` và tài liệu `docs/VAN-HANH.md`. Còn thiếu máy chủ Railway và bản ghi DNS (công ty cấp).
- **1.2 Đăng nhập bằng tài khoản KP Xuxi**: thiết kế ở `docs/CAI-DAT-CHO-HE-THONG-KP.md` mục 3. Hiện dùng khóa truy cập chung và ô chọn vai trò thử.

## Đang chạy thử trên Render gói Free (quyết định 24/11/2026)
- Dữ liệu **không bền**: mất khi deploy hoặc khởi động lại; cần ping `/api/health` để máy không tự tắt (`docs/VAN-HANH.md` mục 1b).
- **Sao lưu tạm bỏ qua** (`KPCHAT_BACKUP=0`). Mã sao lưu và khôi phục vẫn giữ, có test, bật lại khi lên gói có ổ đĩa.
- Do đó **chưa nghiệm thu được** mục 2.4 (không mất tin khi khởi động lại) và 6.1 (sao lưu) trên bản online.

## Chờ công ty cung cấp (xem `docs/KE-HOACH-XUXI.md` mục 3)
- Page Facebook thử, vai trò trên ứng dụng Meta: để thử lại 2.1, 2.2, 2.3 với Page thật. Chức năng đã chạy với Page thật ngày 21-22/11; cần chạy lại trên Page thử do công ty cấp.
- OA Zalo thử: các bước ở `docs/ZALO-OA-CAC-BUOC.md`.
- Nội dung sản phẩm, giá, chính sách Xuxi Fruit và đáp án đúng cho bộ 40 câu. Có nội dung thì nạp vào Kiến thức rồi chạy lại Đánh giá (`botevals.ts`). Điểm gốc trước đây là 33/40, trên tài liệu chỉ có trang sản phẩm.
- Khóa API Anthropic cho bản chạy thật.
- Nơi lưu bản sao lưu ngoài máy chủ (Railway Volume Backups, S3, R2 hoặc Drive).

## Kỹ thuật còn thiếu
| Việc | Mục | Ghi chú |
|---|---|---|
| Đẩy bản sao lưu ra kho tệp ngoài | 6.1 | Hiện sao lưu nằm cùng ổ đĩa (chống lỗi phần mềm và xóa nhầm, không chống mất ổ) |
| Thông báo đẩy ra ngoài KP Chat (Zalo, email, app KP) | 3.3, 6.2 | Đã có âm báo, thông báo trình duyệt, số chưa đọc trên tab, băng cảnh báo cho quản trị, nhật ký `[canh-bao]`. Chưa gửi tin ra ngoài khi không ai mở KP Chat. |
| Chuyển kho JSON sang Postgres | 5.2 | Đo với 5.000 hội thoại và 100.000 tin (tệp 26MB): danh sách 27-110 ms, mở hội thoại 18 ms, tìm trong mọi tin 177 ms, một tin webhook kể cả ghi đĩa 217 ms. Đủ cho Page thử và vài Page. Trên khoảng 500.000 tin thì nên chuyển Postgres (giao diện `Store` đã tách sẵn). Kho JSON chỉ chạy được **một bản** máy chủ. |
| Phân trang tin trong một hội thoại rất dài | 5.2 | Mở hội thoại trả toàn bộ tin của hội thoại đó; chưa thành vấn đề với hội thoại thường. |
| Gửi tệp (pdf, docx) qua Messenger và Zalo OA | 2.2 | Gửi và nhận ảnh đã có; nhận và hiển thị tệp đã có |
| Sự kiện `oa_send_*` của Zalo OA | 2.6 | Tin trả lời bằng app Zalo OA chưa hiện trong KP Chat |
| Làm mới ảnh đại diện khách khi link của Meta hết hạn | 2.1 | Ảnh trong tin đã tải về kho của KP Chat; ảnh đại diện vẫn là link của Meta |
| Kiểm bằng mắt trên điện thoại thật | 5.1 | Đã kiểm bằng giả lập 375px và 390px (Chrome DevTools): không tràn ngang, mở, đọc, ô soạn hiển thị đủ. Chưa thử trên iPhone hay Android thật. |
| Chatbot đọc ảnh khách gửi, tra giá và tồn kho thật, ghi lead | 4.1 | Ảnh thì hiện chuyển người. Giá và tồn kho chờ nối KP Shop. |
| Gỡ hẳn thư viện `zca-js` khỏi dependencies | Ràng buộc 3 | Đã tắt ở mọi lối vào và có test kiểm; mã cũ còn trong repo để đối chiếu. Gỡ hẳn khi được duyệt. |
| Bỏ hẳn mã của chế độ Tự trả lời (`botauto.ts` phần `deliver`) | Ràng buộc 3 | Không còn đường chạy tới phần mã này: lõi gửi tin từ chối tin do máy gửi, có test kiểm. 10 test cũ của chế độ này đang để "skip" kèm lý do. |
| Nhân viên chấm nháp Đúng, Sai, Nguy hiểm; vòng học có người duyệt | 4 | Đề xuất ở `CHATBOT-UU-TIEN-VA-TRI-THUC.md`, chờ duyệt |

## Quyết định đã đổi so với trước (cần biết khi đọc tài liệu cũ)
- **Chế độ "Tự trả lời" của chatbot đã bỏ** (ràng buộc mới). Các mục "Tự trả lời" trong `KE-HOACH-2.0.md` và `CHATBOT-*.md` là lịch sử.
- **Zalo cá nhân đã tắt** (ràng buộc mới). Các mục Zalo cá nhân trong `KE-HOACH-2.0.md` là lịch sử.
- **Bộ lọc Trạng thái** (Đang xử lý / Đã xong / Tất cả) được thêm lại theo yêu cầu 3.1. Ô "Tình trạng" cũ (Đang mở/Hoãn) vẫn bỏ.
