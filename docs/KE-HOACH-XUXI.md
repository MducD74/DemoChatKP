# Kế hoạch: KP Chat 2.0 cho Xuxi Fruit (theo tài liệu yêu cầu công việc)

Lập ngày 24/11/2026. Tạm bỏ qua mục 1.1 (tên miền HTTPS cố định) và 1.2 (đăng nhập bằng tài khoản KP Xuxi) theo chỉ đạo; làm phần còn lại trên máy, sẵn sàng đưa lên máy chủ khi có tên miền.

## 1. Đối chiếu yêu cầu với hiện trạng

| Mục | Yêu cầu | Hiện trạng trước khi làm | Việc cần làm |
|---|---|---|---|
| 1.1 | HTTPS, tên miền cố định | Chạy local + đường hầm tạm | **Tạm bỏ qua.** Chuẩn bị sẵn Dockerfile, hướng dẫn Railway |
| 1.2 | Đăng nhập bằng KP Xuxi, vào thẳng | Cookie chọn vai trò thử + khóa truy cập chung | **Tạm bỏ qua.** Giữ `host.ts` làm chỗ cắm |
| 1.3 | Nhân viên chỉ thấy kênh được phân quyền | Có (phân quyền theo kênh, kiểm ở máy chủ) | Giữ, có test |
| 2.1 | Tin về sau vài giây, có tên và ảnh | Đã chạy thật 21-22/11 | Kiểm lại khi có Page thử |
| 2.2 | Gửi/nhận ảnh | Có | Kiểm lại khi có Page thử |
| 2.3 | Tin trả lời từ app Messenger/Business Suite hiện trong KP Chat | Có (echo) | **Sửa lỗi trùng tin** khi echo về trước lúc lưu tin vừa gửi |
| 2.4 | Không mất, không trùng tin kể cả khởi động lại, webhook gửi lại | Chống trùng theo mã tin; ghi tệp nguyên tử | Ghi tệp có `fsync`, gộp lượt ghi, test khởi động lại và gửi lại webhook |
| 2.5 | Token hết hạn có báo và cách nối lại | Có ở Cài đặt > Kênh | Thêm cảnh báo toàn trang cho quản trị |
| 2.6 | Zalo OA hoặc mô tả bước còn thiếu | Adapter đã viết, chưa có OA | Viết tài liệu các bước còn thiếu |
| 3.1 | Lọc kênh, nhân viên, trạng thái; tìm khách và nội dung | Có lọc kênh, trạng thái, Của tôi/Chưa nhận; tìm theo tin cuối | Lọc theo **nhân viên bất kỳ**; tìm trong **mọi tin** và SĐT |
| 3.2 | Nhận, giao, nhãn, ghi chú, mẫu câu | Có | Giữ |
| 3.3 | Báo tin mới, chưa đọc | Có chưa đọc | Thêm **báo tin mới** (tiêu đề tab, âm báo, thông báo trình duyệt) |
| 4.1-4.2 | Nháp đúng sản phẩm, không bịa, không chắc thì nói rõ | Có lời nhắc và luật chuyển người | Sửa luật từ khóa chặn nhầm câu hỏi cách đặt/thanh toán; nạp tài liệu Xuxi khi công ty gửi |
| 4.3 | Chatbot không tự gửi | **Có chế độ Tự trả lời: vi phạm** | **Bỏ hẳn tự gửi**: chặn ở lõi, chuyển bot cũ về Soạn nháp, bỏ khỏi giao diện |
| 4.4 | Điểm đánh giá bằng `botevals.ts` | Có, đã chạy 33/40 | Chạy lại sau khi có tài liệu Xuxi và khóa AI |
| 5.1 | Điện thoại 375-390px | Có bố cục điện thoại, chưa kiểm bằng mắt | Kiểm và sửa chỗ vỡ |
| 5.2 | Danh sách và tin mở nhanh khi nhiều hội thoại | Mỗi lần hỏi đọc lại cả tệp và quét mọi tin | **Giữ kho trong bộ nhớ, chỉ mục tin theo hội thoại**, giới hạn danh sách trả về |
| 6.1 | Sao lưu hằng ngày, đã thử khôi phục | Chưa có | Script sao lưu (dữ liệu + ảnh, giữ N bản), script khôi phục, test |
| 6.2 | Cảnh báo webhook ngắt, kênh mất kết nối | Có banner ở Cài đặt > Kênh | Đưa cảnh báo lên đầu trang cho quản trị |
| 6.3 | Lùi về bản trước | Chưa có | Hướng dẫn lùi bản (Railway + git tag) |
| 6.4 | Tài liệu vận hành, cài cho KP LBF/Travel, việc chưa làm | Rải rác | Viết `docs/VAN-HANH.md`, `docs/CAI-DAT-CHO-HE-THONG-KP.md`, `docs/VIEC-CHUA-LAM.md` |
| Ràng buộc 3 | Không nối Zalo cá nhân bằng `zca-js` | **Đang có: vi phạm** | **Tắt hẳn**: không đăng ký adapter, không đăng nhập lại khi khởi động, API từ chối, ẩn khỏi giao diện |

## 2. Thứ tự làm
1. Ràng buộc bắt buộc: tắt tự gửi của chatbot, tắt Zalo cá nhân.
2. Sửa các test đang hỏng.
3. Độ tin cậy: sửa trùng tin do echo, ghi kho bền hơn, test khởi động lại và gửi lại webhook.
4. Tốc độ: kho trong bộ nhớ, chỉ mục tin theo hội thoại.
5. Hộp thư: lọc theo nhân viên, tìm trong mọi tin, báo tin mới.
6. Chatbot: sửa luật chuyển người theo từ khóa.
7. Cảnh báo cho quản trị: token hết hạn, webhook ngắt.
8. Vận hành: sao lưu, khôi phục, đóng gói, lùi bản, tài liệu.

## 3. Cần công ty cung cấp (báo sớm)
1. **Page Facebook thử** và quyền quản trị Page đó cho người thực hiện.
2. **Vai trò trên ứng dụng Meta "KP Chat"** (Nhà phát triển hoặc Quản trị) cho người thực hiện, và 1-2 tài khoản Facebook đóng vai khách có vai trò Người dùng thử.
3. **Tên miền** (dự kiến `kpchat.laban.asia`, bản ghi CNAME ở Tenten) và **máy chủ** (Railway: dịch vụ + ổ đĩa bền cho `data/`).
4. **Nội dung Xuxi Fruit** cho chatbot: bảng giá và quy cách, giao hàng và phí, thanh toán, đổi trả, giờ làm việc, câu hỏi thường gặp, giấy tờ an toàn thực phẩm (mẫu A1-A7 trong `CHATBOT-TAI-LIEU-DAO-TAO.md`), và đáp án đúng cho bộ 40 câu mẫu.
5. **Khóa API Anthropic** (nhập ở Cài đặt, lưu mã hóa) và ngân sách tháng.
6. **OA Zalo thử** (nếu có) cùng App ID và khóa bí mật của Zalo for Developers.
7. **Cách đăng nhập KP Xuxi** (khi làm 1.2): định dạng token, khóa ký chung, danh sách vai trò.

## 4. Tiến độ (24/11/2026)
Đã làm và có test (392 test qua, 10 test của chế độ Tự trả lời cũ để "skip" kèm lý do; `tsc` sạch; `next build` production chạy được):

| Mục | Đã làm |
|---|---|
| Ràng buộc 3 | `src/core/guardrails.ts`: chatbot không tự gửi (chặn ở lõi gửi tin, ở lưu chatbot, ở luồng bot; dữ liệu cũ "Tự trả lời" thành Soạn nháp; bỏ khỏi giao diện). Zalo cá nhân tắt ở adapter, khởi động, API, giao diện. `tests/guardrails.test.ts` |
| 2.3, 2.4 | Sửa trùng tin khi echo của Meta về trước lúc lưu tin vừa gửi; chữ kèm ảnh lưu từng phần với đúng mã của Meta. Kho ghi bền (fsync, đổi tên nguyên tử), gộp lượt ghi; webhook trả 200 sau khi đã ghi đĩa; tệp hỏng thì không chạy (không ghi đè bằng kho rỗng). `tests/reliability.test.ts` |
| 2.2 | Ảnh khách gửi được tải từ CDN của Meta về kho ảnh (link Meta hết hạn), chống SSRF. `tests/inboundmedia.test.ts` |
| 2.5, 6.2 | Băng cảnh báo cho quản trị (token hết hạn hoặc bị thu hồi, Page chưa đăng ký nhận tin, webhook ngắt, sao lưu lỗi hoặc quá hạn) kèm nút đi tới chỗ sửa; máy chủ tự kiểm mỗi 5 phút, ghi nhật ký `[canh-bao]` |
| 3.1 | Tìm trong **mọi tin**, tên, số điện thoại, nhãn; không dấu; có đoạn trích. Lọc trạng thái Đang xử lý / Đã xong / Tất cả (lọc theo kênh, nhân viên đã có) |
| 3.3 | Âm báo tin mới, thông báo trình duyệt khi đang ở tab khác, số chưa đọc trên tiêu đề tab; tab ẩn vẫn hỏi tin mới (15 giây) |
| 5.1 | Kiểm bằng giả lập 375px và 390px: không tràn ngang; sửa hàng công cụ danh sách |
| 5.2 | Kho giữ trong bộ nhớ, chỉ mục tin theo hội thoại; danh sách giới hạn 300 kèm "Xem thêm"; trả 304 khi danh sách không đổi. Đo với 100.000 tin: danh sách dưới 110 ms, mở hội thoại 18 ms |
| 6.1 | Sao lưu hằng ngày dữ liệu và ảnh, tự kiểm đọc lại, giữ 14 bản; `npm run backup`, `npm run restore`; khôi phục trên Railway bằng `KPCHAT_RESTORE_FROM`. Đã thử khôi phục. `tests/backup.test.ts` |
| 6.3 | Dockerfile (build chạy test), `railway.json` (1 bản, healthcheck), `/api/health`; hướng dẫn lùi bản |
| 6.4 | `docs/VAN-HANH.md`, `docs/CAI-DAT-CHO-HE-THONG-KP.md`, `docs/VIEC-CHUA-LAM.md`, `docs/ZALO-OA-CAC-BUOC.md` (2.6) |
| Khác | Mở thẳng hội thoại bằng `/?c=<mã>`; sửa test hỏng do mốc thời gian cố định (Human Agent) và test treo do bộ đếm unref (`probeWebhook`); test web chat không còn ghi ảnh vào `data/media` của dự án |
