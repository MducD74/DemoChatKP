# Đánh giá hệ thống chatbot KP Chat cho Labancorp (công ty đa ngành)

Ngày 22/11/2026. Mục tiêu: chatbot giúp **khai thác khách mới và khách cũ trên mọi kênh** cho nhiều thương hiệu (XuXi trái cây cắt sẵn và nước ép, Thực phẩm La Bàn, TixGo, Doca pet, web shop...). Tài liệu này nói thẳng điều đã tốt, điều còn thiếu, rủi ro, và thứ tự làm để có hiệu quả cao nhất. **Điều chưa kiểm chứng được ghi rõ.**

## 1. Kết luận ngắn
- **Nền tảng kỹ thuật đã đủ để chạy thử có kiểm soát**, chưa đủ để để chạy tự động rộng. Thứ thiếu nhiều nhất không phải tính năng chatbot mà là **dữ liệu khách và sản phẩm** (ai là khách cũ, họ đã mua gì, giá và tồn kho hiện tại) cùng **cách đo hiệu quả**.
- Bot hiện **chỉ phản ứng khi khách nhắn**, nên với "khai thác khách cũ" nó chưa làm được phần quan trọng nhất là chủ động chăm sóc và nhắc mua lại.
- **Chưa từng đo chất lượng bot bằng Claude thật trên đủ hội thoại.** Mọi kết luận về chất lượng phải coi là chưa biết cho đến khi đo.
- Việc nên làm ngay: đưa các chatbot đang Tự trả lời về Gợi ý hoặc Nháp, soạn bộ câu hỏi mẫu cho từng thương hiệu, đo 2 tuần, rồi mới mở tự động theo từng nhóm câu hỏi hẹp.

## 2. Hiện trạng: đã có gì
| Nhóm | Đã có | Mức chắc chắn |
|---|---|---|
| Kênh | Messenger, Zalo cá nhân (chỉ soạn nháp, không tự gửi), khung chat nhúng web (đã thử trang giả). Zalo OA, TikTok, Instagram: khung đã có, chưa chạy thật | Đã thử Messenger và web; còn lại chưa |
| Chatbot | Nhiều chatbot, gắn nhiều kênh, 2 loại khách (mới, cũ), 4 chế độ (nháp, gợi ý tham khảo, tự trả lời, tắt) | Đã thử với mô hình giả và một ít hội thoại thật |
| Kiến thức | Văn bản, tệp, PDF, link web, Drive; chọn tài liệu theo chatbot; gợi ý theo kênh | Web chép về còn lẫn chữ rác; chưa thử PDF và Drive thật |
| An toàn | Luật chuyển người viết bằng mã; bot im khi nhân viên nhận; không tự gửi ở Zalo cá nhân; không gửi ngoài cửa sổ trả lời | Đã có test |
| Vận hành | Thanh "bot hay người đang trả lời", Tiếp quản, Giao lại; nút Gợi ý tin nhắn cho nhân viên | Đã thử trên dữ liệu giả |
| Đo lường | Số nháp, dùng, sửa, bỏ, chuyển người, token | Mới là số đếm, chưa gắn với doanh thu |

## 3. Vấn đề và mức ưu tiên
Xếp theo tác động lên kết quả kinh doanh (cao đến thấp), không phải theo độ dễ làm.

### P1. Chưa có dữ liệu khách và sản phẩm thật (ảnh hưởng lớn nhất)
- **Khách cũ chưa được nhận biết đúng.** Hiện "khách cũ" chỉ là hội thoại bắt đầu hơn 7 ngày trước. Bot không biết khách đã mua gì, lần cuối khi nào, có khiếu nại không. Chatbot "Chăm sóc khách cũ" vì thế chỉ hỏi thăm chung chung, không tạo giá trị.
- **Một người, nhiều kênh, chưa gộp.** Cùng một khách nhắn Messenger, Zalo, web sẽ thành ba hồ sơ. Chưa có số điện thoại làm khóa chung, nên không thể nói "khách cũ" xuyên kênh.
- **Giá và tồn kho là bản chép tĩnh.** Giá đổi hoặc hết hàng thì bot nói sai, và nói sai giá là lỗi mất lòng tin lớn nhất. Bản 1.1 từng có công cụ tra giá, hết hàng từ danh mục KP Shop; bản 2.0 chưa nối lại (mục "Sản phẩm KP" mới là chỗ để sẵn).
- **Bot không ghi lại khách tiềm năng.** Khi khách muốn mua, bot chỉ nói "nhân viên sẽ gọi"; tên, số điện thoại, địa chỉ, nhu cầu không được lưu thành lead có cấu trúc, nên dễ rơi mất.

### P2. Chưa đo được hiệu quả, nên không biết nên mở tự động ở đâu
- Chưa có bộ câu hỏi mẫu và điểm chuẩn chất lượng cho từng thương hiệu. Mỗi lần sửa lời nhắc hay tài liệu là "đoán".
- Chưa đo: tỷ lệ bot tự giải quyết, tỷ lệ phải chuyển người và vì sao, tỷ lệ nhân viên sửa hoặc bỏ nháp, thời gian phản hồi đầu, số lead thu được, đơn phát sinh từ chat, chi phí mỗi hội thoại.
- Chưa có vòng học: câu bot không trả lời được không tự thành danh sách việc cho người soạn tài liệu.

### P3. Cách tổ chức đa ngành chưa được chuẩn hóa
- Mỗi thương hiệu cần **giọng, tài liệu, quy tắc và nhân viên phụ trách riêng**, nhưng cũng cần một lớp **chính sách chung** (giờ làm việc, hotline, giao hàng liên thương hiệu). Hệ thống cho phép làm nhưng chưa có quy ước, dễ lẫn.
- **Bỏ lỡ bán chéo.** Khách hỏi XuXi về thịt heo, bot từ chối vì ngoài phạm vi, dù Thực phẩm La Bàn hoặc Doca pet bán. Đây là cơ hội bán thêm của công ty đa ngành mà hiện bot không biết (chưa có tài liệu "danh mục các thương hiệu của Labancorp").
- Cần quyết định rõ: khách của thương hiệu A có được giới thiệu thương hiệu B không, ai nhận lead đó.

### P4. Khai thác khách cũ cần kênh chủ động, mà chat bị giới hạn
- Chatbot chỉ trả lời trong **cửa sổ trả lời của kênh** (Messenger 24 giờ; Zalo OA 7 ngày; TikTok 48 giờ; web chỉ khi khách đang mở trang). Chủ động nhắn ngoài cửa sổ có chính sách riêng của từng nền tảng (tin giao dịch, thông báo một lần, tin truyền thông trả phí...). **Em chưa tra được chính sách chính thức** về chatbot tự động và nhắn chủ động của Meta, Zalo, TikTok; cần tra trước khi làm.
- Zalo cá nhân cho nhắn thoải mái nhưng **dễ bị khoá số**; không dùng cho tự động.
- Vì vậy phần "chăm sóc sau mua, nhắc mua lại" nên đi qua **kênh được phép** (Zalo OA, tin giao dịch, email, SMS) do **người duyệt**, và dùng chat bot để trả lời khi khách phản hồi.

### P5. Vận hành và nhân sự
- **Bot chuyển người nhưng chưa báo ai.** Khách có thể chờ vì không có thông báo đẩy cho nhân viên. Ở chế độ Tự trả lời, nếu không điền "Câu khi chuyển người" thì khách bị im.
- **Chưa định tuyến theo thương hiệu, giờ làm việc.** Hội thoại chuyển người nên đi đúng đội của thương hiệu đó.
- Chưa có người chịu trách nhiệm tài liệu cho từng thương hiệu, và quy trình duyệt trước khi tài liệu đến tay bot.

### P6. Rủi ro tuân thủ và an toàn
- **Dữ liệu khách gửi sang Anthropic** (nội dung chat, tên) khi bot soạn. Cần đưa vào chính sách quyền riêng tư, nói rõ với khách (câu tự giới thiệu là trợ lý tự động đã có), và không đưa thông tin nhạy cảm (số thẻ, CCCD) vào lời nhắc. Chưa có bộ lọc dữ liệu nhạy cảm.
- **Bot nói sai cam kết** (giao trong ngày, hoàn tiền, khuyến mãi) có thể ràng buộc công ty. Hiện chặn bằng lời nhắc và luật chuyển người, chưa có kiểm tra đầu ra tự động.
- **Chạy trên máy cá nhân qua đường hầm tạm** thì máy tắt là bot tắt, và địa chỉ công khai đổi. Cần máy chủ thường trực và tên miền cố định (đã có tài liệu kiến trúc online, chưa làm).
- Khóa API và quyền: khóa đã lưu mã hóa; trang quản trị bản thử **chưa có đăng nhập thật** (ai mở được là làm quản trị), phải bật khóa truy cập khi mở ra Internet.

### P7. Giới hạn kỹ thuật còn lại
- Bot **chưa đọc được ảnh** khách gửi (ảnh sản phẩm, chuyển khoản) và chưa gửi ảnh sản phẩm cho khách; hiện chuyển người.
- Trang web dựng bằng JavaScript có thể chép thiếu sản phẩm; Word, Excel chưa đọc được.
- Giới hạn tần suất khung chat web lưu trong bộ nhớ, chưa đủ khi chạy nhiều máy chủ.
- TikTok, Zalo OA, Instagram chưa nối thật (đang chờ duyệt hoặc cấu hình).

## 4. Đề xuất thiết lập cho Labancorp

### 4.1 Cấu trúc
```
Thương hiệu (XuXi, Thực phẩm La Bàn, TixGo, Doca pet...)
  └─ Kênh của thương hiệu (Messenger, Zalo, web...)
       └─ 2 chatbot: Tư vấn khách mới  +  Chăm sóc khách cũ
Tài liệu: (a) chung toàn công ty  (b) riêng từng thương hiệu  (c) danh mục các thương hiệu để giới thiệu chéo
```
- Đặt tên chatbot theo mẫu `<Thương hiệu> - <Loại> - <Kênh>`; mỗi thương hiệu một bộ quy tắc giọng điệu riêng.
- Tài liệu "Danh mục thương hiệu Labancorp": mỗi thương hiệu bán gì, link, hotline. Quy tắc: khách hỏi thứ thương hiệu khác bán thì **giới thiệu thương hiệu đó** (và ghi nhãn chuyển giao) thay vì từ chối.

### 4.2 Mức tự động theo loại câu hỏi (không theo toàn kênh)
| Nhóm câu hỏi | Mức đề nghị | Điều kiện để nâng mức |
|---|---|---|
| Giờ mở cửa, địa chỉ, phí ship, chính sách đổi trả, giới thiệu sản phẩm có trong tài liệu | Tự trả lời | Điểm chuẩn đạt ≥ 95% đúng trên bộ câu mẫu, 2 tuần chạy nháp |
| Báo giá, còn hàng | Nháp có người duyệt, sau đó tự trả lời khi nối danh mục thật | Giá lấy trực tiếp từ KP Shop |
| Tư vấn chọn món, gợi ý combo | Nháp hoặc gợi ý cho nhân viên | Nhân viên dùng nguyên văn hoặc sửa nhẹ ≥ 70% |
| Đặt hàng, thanh toán, đổi trả cụ thể, khiếu nại, giá sỉ | Luôn người xử lý | Không nâng |
| Khách cũ, chăm sóc sau mua | Nháp có duyệt | Cần dữ liệu đơn hàng |

### 4.3 Chỉ số cần theo dõi (mục tiêu đặt sau 2 tuần đo nền)
- Tỷ lệ tin khách được bot trả lời đúng (do nhân viên chấm mẫu).
- Tỷ lệ nháp dùng nguyên, sửa, bỏ; tỷ lệ chuyển người và lý do.
- Thời gian phản hồi đầu (trước và sau chatbot), tỷ lệ khách bỏ đi vì chờ.
- Số lead có số điện thoại, tỷ lệ lead thành đơn, doanh thu từ hội thoại có bot.
- Tỷ lệ khách quay lại mua (khách cũ) theo nhóm có và không có chăm sóc.
- Chi phí mô hình mỗi hội thoại, mỗi đơn.

## 5. Lộ trình đề xuất
**Giai đoạn 0 (ngay, vài ngày): an toàn và nền đo**
1. Đưa mọi chatbot đang Tự trả lời về **Gợi ý tham khảo hoặc Soạn nháp** cho đến khi kiểm xong.
2. Mỗi thương hiệu một người chịu trách nhiệm tài liệu; dọn tài liệu web, nhập bảng giá và chính sách thật.
3. Soạn **bộ 40 câu hỏi mẫu mỗi thương hiệu** (câu thật, đã ẩn danh) kèm câu trả lời đúng; chạy lại mỗi lần sửa.
4. Điền "Câu khi chuyển người"; thêm thông báo cho nhân viên (việc cần làm).

**Giai đoạn 1 (2 đến 4 tuần): bán hàng và dữ liệu**
5. **Thu lead có cấu trúc**: bot hỏi tên, số điện thoại, địa chỉ, nhu cầu và ghi vào hồ sơ khách; chuyển người kèm tóm tắt.
6. **Hồ sơ khách hợp nhất theo số điện thoại** xuyên kênh; nối với KP CRM.
7. **Nối danh mục KP Shop** để tra giá, tồn kho thật (khôi phục công cụ tra giá của 1.1).
8. Thông báo đẩy và định tuyến theo thương hiệu, giờ làm việc.

**Giai đoạn 2 (1 đến 2 tháng): tự động có chọn lọc và chăm sóc khách cũ**
9. Mở **Tự trả lời cho nhóm câu hỏi hẹp** đã đạt chuẩn (mục 4.2); ngoài giờ làm việc bot nhận khách và gom lead.
10. Chăm sóc khách cũ: nhóm khách theo CRM (mua lần cuối, chu kỳ mua), **kịch bản nhắn có người duyệt** qua kênh được phép (Zalo OA, tin giao dịch, SMS), sau khi tra chính sách từng nền tảng.
11. Giới thiệu chéo giữa các thương hiệu, đo bằng lead chuyển giao.
12. Đọc ảnh khách gửi, gửi ảnh sản phẩm.

**Giai đoạn 3: quy mô**
13. Máy chủ thường trực, tên miền cố định, đăng nhập quản trị thật, sao lưu; giới hạn tần suất dùng kho chung.
14. Báo cáo doanh thu theo chatbot, kiểm thử A/B lời nhắc, quy trình học từ câu bot không trả lời được.

## 6. Những quyết định cần anh Khai chốt
1. **Mục tiêu đo**: ưu tiên số lead, doanh thu hay tốc độ phản hồi trong quý đầu?
2. **Ai chịu trách nhiệm tài liệu và chất lượng** của từng thương hiệu?
3. **Chính sách dữ liệu khách**: cho phép đưa nội dung chat sang nhà cung cấp mô hình, thông báo cho khách thế nào?
4. **Ưu tiên tích hợp**: nối KP Shop (giá, tồn kho) hay KP CRM (khách cũ) trước? Em đề nghị KP Shop trước vì giá sai là rủi ro lớn nhất.
5. **Ngưỡng chấp nhận để mở tự động**: tỷ lệ đúng tối thiểu, tỷ lệ sai nghiêm trọng tối đa (ví dụ sai giá).
6. **Giới thiệu chéo giữa thương hiệu**: có bật không, lead chia thế nào.
7. **Ngân sách mô hình** mỗi tháng và mỗi thương hiệu (đã có hạn mức nháp theo ngày).

## 7. Điều em chưa biết hoặc chưa kiểm
- Chất lượng thật của bot với Claude trên số hội thoại đủ lớn, và tỷ lệ chuyển đổi chat thành đơn của các thương hiệu hiện tại.
- Chính sách chính thức của Meta, Zalo, TikTok về chatbot tự trả lời và nhắn chủ động.
- Hiệu quả khung chat nhúng trên KP Shop thật (mới thử trang giả).
- Dữ liệu KP CRM và KP Shop có sẵn sàng (API, cấu trúc) để nối hay không.
