# Đối chiếu KP Chat 1 (trong KPF) và KP Chat 2.0

Ngày: 2026-11-22. Mục đích: biết chức năng nào đã có ở bản nào, để không làm trùng khi gắn bot và nối 2.0 vào KPF.

Nguồn: `kpf-lbf` (`Chat.tsx`, `chat-actions.ts`, `chat-crm.ts`, `chat-bot.ts`, `docs/KP-CHAT*.md`, `docs/DE-XUAT-KP-CHAT.md`) và `kp-chat` (`docs/KE-HOACH-2.0.md`, `src/core`, `src/components`). Em đọc mã và tài liệu, chưa chạy so sánh từng màn hình. Ô ghi "chưa thấy" nghĩa là em không tìm thấy trong mã hay tài liệu, chưa chắc là không có.

Ký hiệu: Có, Một phần, Chưa có, Chưa thử (đã viết nhưng chưa thử với tài khoản thật).

## A. Kênh và gửi nhận tin
| Chức năng | KP Chat 1 (qua Pancake) | KP Chat 2.0 (nối thẳng) | Ghi chú |
|---|---|---|---|
| Messenger | Có | Một phần: đã thử nối thật 21 và 22/11, chưa xong hết | |
| Instagram | Chưa thấy | Một phần: cùng đợt thử với Meta | |
| Zalo OA | Có | Chưa thử với OA thật | |
| Zalo cá nhân | Có (qua Pancake) | Chưa thử: tạo được mã QR, chưa đăng nhập số thật; chỉ gửi chữ; bot không bao giờ tự gửi | Cách nối không chính thức, dễ bị khóa số |
| TikTok | Có | Chưa thử, cần điều kiện truy cập | |
| Khung chat nhúng website | Chưa có | Có | Chỉ có ở 2.0 |
| Cách nhận tin | Hỏi lại Pancake mỗi 45 giây | Webhook, tức thì | |
| Giới hạn dữ liệu | Mỗi kênh tối đa 100 hội thoại gần nhất, khoảng ngày tối đa 31 ngày, Pancake giới hạn tốc độ | Tự lưu lịch sử | |
| Gửi chữ | Có | Có | |
| Gửi ảnh | Có | Có (trừ Zalo cá nhân) | |
| Gửi tệp (PDF, tài liệu) | Có | Chưa có | Nhận và hiển thị tệp thì 2.0 có |
| Đếm ngược cửa sổ trả lời | Có | Có, chặn gửi khi quá hạn | |
| Trả lời sau 24 giờ (thẻ Human Agent) | Chưa thấy | Đã viết, tắt mặc định | |
| Công tắc gửi tin theo kênh | Có, mặc định tắt | Có, mặc định tắt | |

## B. Hộp thư và công cụ nhân viên
| Chức năng | KP Chat 1 | KP Chat 2.0 | Ghi chú |
|---|---|---|---|
| Bố cục 3 cột (danh sách, khung chat, hồ sơ) | Có | Có | |
| Lọc kênh, trạng thái, nhân viên, thời gian | Có | Một phần: lọc Của tôi, Chưa nhận; tìm tên, nội dung, nhãn | Chưa thấy lọc theo thời gian ở 2.0 |
| Lọc "Có SĐT", "Chưa đẩy CRM" | Có | Chưa có | Gắn với CRM |
| Chưa đọc theo từng nhân viên | Có (tab Chưa trả lời) | Có (chấm xanh, số trên tab) | |
| Nháp riêng từng hội thoại | Có | Có | |
| Ghi chú nội bộ | Có | Có | |
| Mẫu trả lời nhanh, biến tên khách và sale | Có | Có | |
| Thư viện ảnh theo thư mục | Có | Có | |
| Nhãn gắn nhanh dưới ô soạn | Có, đồng bộ nhãn Pancake | Một phần: nhãn dạng chip | Cần tối ưu, xem tài liệu đề xuất mục 2.5 |
| Quản lý nhãn (ghim, nhóm) | Có | Chưa thấy | |
| Nhật ký thao tác | Có (tab Nhật ký) | Chưa thấy | |
| Nhiệm vụ từ hội thoại (KP Tasks) | Có | Chưa có | Chờ nối KPF |
| Giao người phụ trách, nhận khách | Có | Có | |
| Chuyển bot thành người và ngược lại | Chưa có (bot ẩn) | Có: Tiếp quản, Giao lại cho bot | |

## C. KP CRM và KPF
| Chức năng | KP Chat 1 | KP Chat 2.0 | Ghi chú |
|---|---|---|---|
| Hồ sơ khách theo SĐT (lịch sử, ghi chú) | Có | Chưa có (chỉ tên và ảnh khách lấy từ kênh) | Chờ nối KPF |
| Lead KP CRM và giai đoạn (Tình trạng) | Có, đổi giai đoạn, lý do mất đơn | Chưa có | |
| Tạo lead, báo trùng SĐT | Có | Chưa có | |
| Lưu thông tin khách đồng bộ sang lead | Có | Chưa có | |
| Đổi người phụ trách đồng bộ sang lead | Có | Chưa có | |
| Đơn hàng (hóa đơn KiotViet, chỉ đọc) | Có | Chưa có | Quy ước không ghi vào KiotViet |
| Phân quyền theo vai trò, phòng ban KPF | Có | Một phần: theo kênh có, theo phòng ban chờ nối KPF | |
| Đăng nhập, danh sách nhân viên | Của KPF | Bản giả để thử | Thay bằng lớp nối KPF |

## D. Vận hành
| Chức năng | KP Chat 1 | KP Chat 2.0 | Ghi chú |
|---|---|---|---|
| Chia khách tự động | Chưa thấy (giao tay, Nhận) | Có: xoay vòng, theo tải, cố định, tỷ lệ, ưu tiên người trực | |
| SLA, thời gian phản hồi | Chưa có (ghi rõ chưa lưu lịch sử) | Có, kèm cảnh báo sắp vượt | |
| Thống kê theo kênh, nhân viên, nhãn | Có (số lượng, có SĐT, đã có lead) | Có (thêm SLA) | 2.0 chưa có "có lead" |
| Tổng quan quản trị | Chưa thấy | Có | |
| Công tắc "Đang nhận khách" | Chưa thấy | Có | |

## E. Chatbot
| Chức năng | KP Chat 1 | KP Chat 2.0 | Ghi chú |
|---|---|---|---|
| Soạn nháp cho nhân viên | Chưa có online: mã nấc 1 viết sẵn nhưng đang tắt (`SHOW_BOT=false`), nhân viên không thấy nút AI | Có | KP Chat 1 thực tế chưa có chatbot |
| Bot tự trả lời | Chưa (chỉ thiết kế) | Có, quản trị bật | |
| Nhiều chatbot, theo loại khách mới và khách cũ | Chưa có | Có | |
| Kho kiến thức (tệp, PDF, web, Drive) | Chưa có (chỉ ô quy tắc riêng) | Có | |
| Thư viện kịch bản | Chưa có | Có (chưa gắn vào bot) | |
| Tra giá và còn hàng từ danh mục thật | Mã viết sẵn (`tim_san_pham`), chưa chạy online, em chưa thử | Chưa có | Có thể mượn lại phần tra danh mục, cần thử trước khi tin |
| Chi phí theo tiền (ngày, tháng) | Mã viết sẵn (đô la), chưa chạy online | Một phần: chỉ đếm token | |
| Nhật ký gợi ý, đếm dùng nháp hay bỏ nháp | Mã viết sẵn, chưa chạy online | Có (thống kê theo chatbot) | |
| Nhân viên chấm Đúng, Sai, Nguy hiểm | Chỉ thiết kế | Chưa có | Đưa vào vòng học |
| Luật dừng và chuyển người viết bằng mã | Chỉ thiết kế | Có | |
| Nhiều ngôn ngữ | Chưa thấy | Có (vi, en, ko, zh, ru trên web) | |
| Khung chat web gắn chatbot | Chưa có | Có | |

## Kết luận

1. **2.0 chưa thay được 1.** 2.0 hơn ở kênh nối thẳng, chia khách, SLA, chatbot. Nhưng toàn bộ phần KP CRM, đơn hàng, nhiệm vụ, phòng ban của 1 chưa có ở 2.0.
2. **Không làm lại phần CRM ở 2.0.** Khi nối KPF, dùng các hàm của 1 qua lớp nối (hồ sơ khách, tạo lead, đổi giai đoạn, nhiệm vụ).
3. **Chatbot chỉ thật sự có ở 2.0.** KP Chat 1 chưa có chatbot chạy online, nên không có gì trùng để lo. Chỉ có vài đoạn mã viết sẵn nhưng tắt (tra giá và còn hàng, chi phí theo tiền) có thể mượn sau khi thử.
4. **Mang từ 2.0 sang 1 khi hợp nhất:** kênh nối thẳng, chia khách, SLA, bot nhiều chế độ.
5. **Chạy song song cần cẩn thận:** một kênh chỉ nên nối một bản (qua Pancake hay nối thẳng). Cắt chuyển từng kênh, không để hai bản cùng trả lời một Page.

## Việc đối chiếu còn lại
- Chạy so sánh từng màn hình trên hai bản (em mới đối chiếu qua mã và tài liệu).
- Kiểm các ô "chưa thấy": Instagram và quản lý nhãn ở bản 1, nhật ký thao tác ở bản 2.0.
