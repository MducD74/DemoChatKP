# Chatbot Labancorp: thứ tự ưu tiên đã chốt và đề xuất phần Tri thức

Ngày: 2026-11-22. Nguồn: khảo sát anh Khai điền trong phiên chat.

## 1. Quyết định của anh

Mục tiêu quý đầu (số 1 là quan trọng nhất):
1. Giảm việc cho nhân viên
2. Trả lời khách nhanh hơn
3. Doanh thu từ chat
4. Số khách để lại số điện thoại

Việc cần làm tiếp, theo thứ tự:
1. Báo nhân viên khi bot chuyển người
2. Hồ sơ khách theo số điện thoại, nối KP CRM
3. Thu thông tin khách có cấu trúc (tên, số điện thoại, địa chỉ, nhu cầu)
4. Tài liệu chung và danh mục các thương hiệu Labancorp
5. Nối KP Shop để bot biết giá và tồn kho thật
6. Đo hiệu quả: bộ câu mẫu, chỉ số, báo cáo theo chatbot

Chính sách:
- Khách hỏi món của thương hiệu khác trong Labancorp: giới thiệu thương hiệu đó kèm link, có nhãn để đo.
- Nội dung chat gửi sang Anthropic: cho phép và ghi vào chính sách riêng tư (xem `CHATBOT-THONG-BAO-RIENG-TU.md`).

Việc làm ngay đã được giao cho em:
- Đưa chatbot đang Tự trả lời về Gợi ý tham khảo: đã làm trên bản chạy thử (cổng 3031) cho Xuxi Chatbot và Chatbot Web Shop LBF.
- Câu khi chuyển người: Xuxi Chatbot đã điền, Web Shop LBF đã có sẵn câu của anh nên giữ nguyên.
- Khung 40 câu hỏi mẫu: `CHATBOT-BO-CAU-HOI-MAU.md`.
- Câu thông báo trợ lý tự động: `CHATBOT-THONG-BAO-RIENG-TU.md`.

Ba ý nhỏ anh chưa chốt, em đề xuất:
- Tỷ lệ đúng tối thiểu để mở Tự trả lời: 95% trên bộ 40 câu mẫu, và không câu nào ở nhóm Tình huống khó bị Không đạt.
- Ngân sách mô hình: bắt đầu 1.000.000 đ mỗi tháng, bot tự dừng khi chạm mức này (cần làm thêm công tắc ngân sách), xem lại sau 1 tháng chạy.
- Người phụ trách tài liệu từng thương hiệu: anh chọn một người cho mỗi thương hiệu.

## 2. Đề xuất phần Tri thức: bot học từ các phiên chat

Nguyên tắc: bot không tự sửa mình. Mọi thứ bot "học" phải qua một người duyệt rồi mới thành tri thức. Lý do: học thẳng từ chat thật dễ học nhầm, lộ dữ liệu khách, hoặc học cả câu sai của nhân viên.

### 2.1 Bốn nguồn tín hiệu (đã có sẵn một phần dữ liệu)
1. Nháp bị nhân viên sửa: so bản bot soạn và bản nhân viên gửi, phần khác nhau cho biết bot sai ở đâu.
2. Nháp bị bỏ hoặc bot chuyển người: gom lại thành "câu bot chưa trả lời được", nhóm theo chủ đề.
3. Câu nhân viên tự trả lời khi khách hỏi điều chưa có trong tài liệu: ứng viên cho một cặp hỏi và đáp mới.
4. Kết quả của cuộc chat: khách để lại số điện thoại, có đơn, hay bỏ đi. Dùng để biết cách trả lời nào hiệu quả.

### 2.2 Luồng
Tín hiệu, rồi "Đề xuất học" (hàng chờ), rồi người phụ trách thương hiệu bấm Duyệt, Sửa hoặc Bỏ, rồi thành mẩu tri thức đang dùng. Chỉ mẩu đã duyệt mới được đưa cho bot.

Bốn loại đề xuất:
- Hỏi và đáp mới (từ nguồn 3).
- Quy tắc sửa lỗi (từ nguồn 1), ví dụ "không hứa giao trong 1 giờ".
- Chỗ thiếu tài liệu (từ nguồn 2): danh sách chủ đề bot hay bí, nhắc người phụ trách bổ sung.
- Mẫu câu hiệu quả (từ nguồn 4): câu dẫn đến để lại số điện thoại hoặc chốt đơn.

### 2.3 Lưu trữ
- Không lưu nguyên cuộc chat vào tri thức. Chỉ lưu mẩu đã viết lại ngắn gọn, đã xóa tên, số điện thoại, địa chỉ khách.
- Mỗi mẩu gồm: nội dung, thương hiệu, kênh áp dụng, loại, trạng thái (đề xuất, đang dùng, đã thu hồi), nguồn (mã hội thoại và ngày, để truy lại), người duyệt, ngày duyệt, số lần bot dùng, điểm chấm gần nhất.
- Có thu hồi và lịch sử phiên bản: mẩu gây sai thì tắt được ngay, và biết nó đến từ đâu.
- Phân tầng để không lẫn giữa các thương hiệu: tri thức chung Labancorp (chính sách, bảo hành, liên hệ) và tri thức riêng từng thương hiệu. Chatbot chỉ nhận phần chung cộng phần của thương hiệu mình.
- Khi tri thức nhiều lên, chỉ đưa cho bot các mẩu liên quan đến câu khách hỏi (tìm theo từ khóa trước), không nhét hết vào mỗi lần soạn, để rẻ và đỡ nhầm.
- Dữ liệu cuộc chat gốc vẫn ở kho hội thoại và theo thời gian lưu trong chính sách riêng tư. Tri thức học được là kho riêng, nhỏ.

### 2.4 Đo hiệu quả của việc học
- Chạy bộ 40 câu mẫu trước và sau khi duyệt một đợt mẩu mới. Điểm giảm thì thu hồi đợt đó.
- Theo dõi theo chatbot: tỷ lệ nháp dùng nguyên văn, tỷ lệ phải sửa, tỷ lệ chuyển người, số khách để lại số điện thoại.

### 2.5 Việc không nên làm lúc này
- Không huấn luyện lại mô hình (fine-tune) từ chat khách: tốn, khó đảo ngược, rủi ro dữ liệu.
- Không cho bot tự thêm tri thức mà không có người duyệt.

### 2.6 Đề xuất thứ tự làm
1. Hàng chờ "Đề xuất học" từ nháp bị sửa và câu chuyển người (nguồn 1 và 2).
2. Duyệt, thu hồi, gắn thương hiệu và ẩn thông tin khách.
3. Chấm trước và sau bằng bộ câu mẫu (nối với việc "Đo hiệu quả" của anh).
4. Cặp hỏi đáp từ nhân viên và mẫu câu hiệu quả (nguồn 3 và 4), làm sau khi đã có hồ sơ khách và dữ liệu kết quả từ KP CRM.

Trạng thái: chưa làm gì ở phần 2, chờ anh đồng ý hướng này.
