# Đề xuất: chatbot tư vấn như sale giỏi, tự học, và giao diện dễ dùng

Ngày: 2026-11-22. Trạng thái: ĐỀ XUẤT, chưa làm gì. Chờ anh Khai chọn.

Phạm vi theo lời anh: ưu tiên số 1 là chatbot tư vấn như người sale giỏi và có cơ chế tự cải thiện. Phần kỹ thuật làm sau. Lưu trữ dữ liệu đã có KP CRM lo. Giao diện (nhân viên và khách) học theo Preny.

Lưu ý nguồn: em không mở được Preny trong trình duyệt của em (trình duyệt em không thấy tab anh đang mở, và trang tự chuyển sang tên miền khác nên bị chặn). Phần nhận xét giao diện Preny dưới đây chỉ dựa trên ảnh chụp anh gửi. Muốn nghiên cứu sâu hơn, anh gửi thêm ảnh các màn hình thiết lập bot, kịch bản, kiến thức, thống kê của Preny.

---

## Phần 0. Đã có ở KP Chat 1 (trong KPF), nên không làm lại

Cập nhật sau khi anh nhắc. Em đọc mã và tài liệu KP Chat 1 (`Chat.tsx`, `chat-actions.ts`, `chat-crm.ts`, `chat-bot.ts`, `docs/DE-XUAT-KP-CHAT.md`, `docs/KP-CHAT-TOM-TAT.md`) và mở KPF để xem màn hình danh sách (không mở hội thoại nào của khách). KP Chat 1 hiện đọc tin qua Pancake, nằm trong KPF, và nối KP CRM sẵn.

| Việc | Đã có ở KP Chat 1 | Quyết định |
|---|---|---|
| Hồ sơ khách ở cột phải | Có: lead CRM (giai đoạn, việc tiếp), ghi chú, nhiệm vụ KP Tasks, lịch sử CRM, đơn hàng (hóa đơn KiotViet gần nhất, tổng tiền) | Không làm panel mới. Bot đọc cùng nguồn này |
| "Trạng thái tư vấn" | Có dưới tên **Tình trạng** = giai đoạn lead của KP CRM, đổi được, có lý do mất đơn, lọc "Chưa đẩy CRM", "Có SĐT" | Dùng chính giai đoạn lead này làm giai đoạn tư vấn, không tạo bộ giai đoạn thứ hai |
| Tạo lead, khớp SĐT | Có: `leadFromChat`, phát hiện trùng SĐT, lưu thông tin khách đồng bộ sang lead | Bot ghi thông tin qua đúng các hàm này, không có kho lead riêng |
| Liệt kê đơn hàng | Có (đọc hóa đơn KiotViet) | Giữ. "Tạo đơn" ngay trong chat là việc khác, xem Phần 4 |
| Nhãn | Có: thanh nhãn dưới ô soạn, đồng bộ nhãn Pancake, quản lý nhãn (ghim, nhóm), thống kê theo nhãn | Chỉ tối ưu, xem 2.5 |
| Thống kê | Có: số hội thoại, có SĐT, đã có lead, theo kênh và nhân viên | Thêm chỉ số của bot, chưa có thời gian phản hồi (đang chờ SLA) |
| Chatbot AI | **Chưa có chatbot chạy online.** Chỉ có mã nấc 1 viết sẵn nhưng đang ẩn (`SHOW_BOT=false`): công cụ `tim_san_pham` tra giá và còn hàng, chi phí, nhật ký. Chưa thử | Chatbot xây ở KP Chat 2.0. Có thể mượn lại phần tra danh mục sau khi thử |
| Dấu hiệu kết quả | Nhân viên đã gắn nhãn **Chốt** và **Không chốt** (em thấy trong danh sách) | Dùng làm "đáp án" để chấm bot và chọn cuộc chat thắng, không tạo thêm nhãn kết quả |

Bảng đối chiếu đầy đủ hai bản: `DOI-CHIEU-KP-CHAT-1-VA-2.md`.

**Cách tránh trùng lặp: bot dùng chung nguồn, không giữ bản sao.** KP Chat 2.0 chưa nối KPF nên em sẽ định nghĩa ba "cổng" thay vì chép logic:
- Cổng hồ sơ khách: đọc lead, lịch sử, đơn theo SĐT (về sau gọi `crmProfile` của KPF).
- Cổng danh mục: tìm món, giá, còn hàng (về sau mượn lại phần tra danh mục viết sẵn ở KP Chat 1, sau khi thử).
- Cổng ghi lead: tạo lead, lưu thông tin khách, đổi giai đoạn (về sau gọi `createLead`, `syncLeadInfo`, `moveLeadByConv`).
Giờ cắm bản giả để thử; khi nối KPF thì cắm hàm thật. Nhờ vậy không có kho khách, lead hay giá thứ hai.

---

## Phần 1. Làm sao bot tư vấn như sale giỏi

### 1.1 Sale giỏi khác sale thường ở đâu
1. Hỏi để hiểu trước khi báo giá (dịp gì, mấy người, ngân sách, khi nào cần, giao đâu).
2. Nhớ khách: khách đã mua gì, thích gì, đã nói gì hôm trước.
3. Gợi ý ít mà đúng (1 đến 3 món) và nói vì sao hợp.
4. Xử lý từ chối khéo: chê đắt, so sánh nơi khác, "để mình suy nghĩ".
5. Luôn dẫn tới bước tiếp theo: xin số điện thoại, chốt đơn, hẹn giờ.
6. Biết lúc nào nên im và đưa cho người thật (khách giận, đơn lớn, khiếu nại).
7. Giọng đúng thương hiệu, có cảm xúc, không máy móc.

### 1.2 Bot của mình hiện có gì và thiếu gì
Đã có: nguyên tắc tư vấn trong lời nhắc, tài liệu, mẫu trả lời, luật chuyển người, chế độ gợi ý và nháp, thư viện kịch bản (chưa gắn vào bot).

Còn thiếu so với sale giỏi:
- Bot không biết giá và tồn kho thật (chưa nối KP Shop), nên dễ né hoặc hẹn.
- Bot không nhớ khách qua các lần (chưa nối KP CRM).
- Bot không theo dõi mình đang ở giai đoạn nào của cuộc tư vấn, và đã biết gì về khách.
- Kịch bản chưa được dùng.
- Chưa có thước đo "sale giỏi" nên chưa biết bot tốt lên hay tệ đi.
- Chưa có vòng học từ người thật.

### 1.3 Đề xuất kiến trúc "bộ não sale" gồm 5 lớp

**Lớp 1. Dữ kiện đúng (dùng cổng danh mục, không làm mới).** Giá, còn hàng lấy từ danh mục bán lẻ của KPF. KP Chat 1 có sẵn mã tra (`tim_san_pham`) nhưng đang tắt và em chưa thử, nên chỉ mượn sau khi thử. Bot chỉ nói những gì cổng trả về. Phần thêm mới nếu anh muốn: ảnh và combo, khuyến mãi.

**Lớp 2. Giai đoạn và "bot đã biết gì" (giai đoạn dùng lead KP CRM).**
- Giai đoạn tư vấn chính là giai đoạn lead hiện có ở KP CRM (Tình trạng). Bot chọn kịch bản theo giai đoạn này, và đề nghị chuyển giai đoạn qua đúng hàm hiện có để nhân viên xác nhận.
- Phần thật sự mới: bot ghi lại những điều khách đã nói (dịp, số người, ngân sách, thời gian, địa chỉ, món quan tâm) vào chỗ thông tin khách và ghi chú đang có, rồi hỏi tiếp điều còn thiếu thay vì hỏi lại. Qua cổng ghi lead, không có kho riêng.

**Lớp 3. Trí nhớ khách (dùng cổng hồ sơ khách).** Khi biết số điện thoại, bot đọc cùng hồ sơ mà cột phải của KP Chat 1 đang hiện: lịch sử, đơn, ghi chú. Chỉ thêm việc đưa tóm tắt đó vào lời nhắc cho bot, để chăm sóc và nhắc mua lại đúng lúc.

**Lớp 4. Học từ người sale giỏi.** Nguồn học tốt nhất là những cuộc chat nhân viên giỏi đã chốt được đơn hoặc lấy được số điện thoại.
- Em chọn ra các cuộc chat thắng: những cuộc nhân viên đã gắn nhãn Chốt (hoặc lead thắng), kèm cách người đó hỏi, xử lý chê đắt, dẫn tới chốt.
- Xóa thông tin khách, rút ra "mẫu thắng" theo tình huống.
- Người phụ trách duyệt rồi mới đưa vào kho. Khi bot trả lời, hệ thống chọn 2 đến 3 mẫu thắng gần nhất với tình huống để bot học theo cách nói đó.

**Lớp 5. Chấm điểm và cải tiến.**
- Mỗi cuộc chat được chấm theo tiêu chí "sale giỏi" (xem 1.5) bằng mô hình chấm, mẫu nhỏ kiểm bằng người.
- Báo cáo mỗi tuần: bot hay sai ở đâu, câu nào khách rời đi, kịch bản nào thắng.
- Thử hai phiên bản kịch bản trên hai nhóm khách để chọn bản tốt hơn.

### 1.4 Cơ chế tự học: vòng lặp có người duyệt
Thu thập, rồi phân loại, rồi đề xuất, rồi duyệt, rồi áp dụng, rồi đo kết quả.

| Bước | Làm gì |
|---|---|
| Thu | Nháp bị sửa, câu bot chuyển người, cuộc chat chốt thắng, cuộc chat khách bỏ đi |
| Phân loại | Bot sai thông tin, sai giọng, thiếu tài liệu, kịch bản chưa có, mẫu thắng mới |
| Đề xuất | Hàng chờ "Đề xuất học": thêm tài liệu, sửa kịch bản, thêm mẫu thắng, thêm quy tắc |
| Duyệt | Người phụ trách thương hiệu bấm Duyệt, Sửa hoặc Bỏ |
| Áp dụng | Chỉ mẩu đã duyệt mới vào bot, có thu hồi |
| Đo | Chạy lại bộ câu mẫu và so chỉ số trước và sau, giảm thì thu hồi |

Nguyên tắc: bot không tự sửa mình. Học qua tài liệu, kịch bản, mẫu thắng, không huấn luyện lại mô hình.

### 1.5 Thước đo "sale giỏi" (đề xuất, 8 tiêu chí, mỗi tiêu chí 0 đến 2 điểm)
1. Hỏi nhu cầu trước khi báo giá.
2. Thông tin đúng với tài liệu (không bịa).
3. Gợi ý đúng món, kèm lý do.
4. Xử lý được lời từ chối.
5. Dẫn tới bước tiếp theo rõ ràng.
6. Giọng đúng thương hiệu, có cảm xúc.
7. Biết chuyển người đúng lúc.
8. Ngắn gọn, dễ đọc trên điện thoại.

Chỉ số kết quả: tỷ lệ cuộc chat để lại số điện thoại, tỷ lệ ra đơn, thời gian phản hồi đầu, tỷ lệ nháp dùng nguyên văn, tỷ lệ chuyển người.

### 1.6 Mức tự động tăng dần theo từng nhóm câu hỏi
Thay vì bật Tự trả lời cho cả chatbot, mở theo nhóm: nhóm câu nào bot đạt 95% trên bộ câu mẫu thì cho tự trả lời nhóm đó (chào hỏi, hỏi giá, giao hàng...). Nhóm khó (phàn nàn, hoàn tiền, đơn lớn) luôn nháp hoặc chuyển người. An toàn hơn và cho thấy bot tiến bộ từng bước.

---

## Phần 2. Giao diện: học theo Preny

### 2.1 Điều em thấy ở Preny (từ ảnh anh gửi)
- Màn hình ba cột: danh sách hội thoại, khung chat, panel khách hàng bên phải.
- Danh sách có ô tìm theo tên và số điện thoại, chọn kênh, sắp xếp, bộ lọc. Mỗi dòng có huy hiệu kênh trên ảnh đại diện, nhãn màu, giờ.
- Đầu khung chat có nút chọn "Preny AI": bật hoặc đổi bot ngay trên từng hội thoại.
- Panel bên phải có hai tab: Thông tin và Tạo đơn. Có "Trạng thái hội thoại" và "Trạng thái tư vấn" tách riêng, danh sách ghi chú, danh sách đơn hàng và nút tạo đơn.
- Ô soạn tin có nút ảnh, video, mẫu nhanh, gửi.
- Thanh trên có bộ đếm lượt AI còn lại và chuông thông báo.

### 2.2 So với KP Chat 1 (KPF) và KP Chat 2.0
KP Chat 1 đã có gần hết thứ Preny có ở cột phải: hồ sơ khách, lead và giai đoạn, ghi chú, nhiệm vụ, lịch sử, đơn hàng, thanh nhãn, tìm theo SĐT, lọc "Chưa đẩy CRM", thống kê. KP Chat 2.0 đã có: thanh người xử lý bot hay người, Tiếp quản và Giao lại cho bot, Gợi ý tin nhắn kèm "vì sao", thư viện mẫu, nhãn "Bot: cần người".

Phần còn thiếu thật sự, tính trên cả hai:
- **Chuyển bot sang người trong cùng một màn hình:** KP Chat 1 chưa hiện bot, KP Chat 2.0 chưa có hồ sơ khách. Cần hợp lại khi nối KPF.
- **Bot đã biết gì về khách** hiển thị cho nhân viên (mới).
- **Hàng đợi cần người** và thời gian chờ (việc số 1 của anh).
- **Bộ lọc nhanh theo bot:** bot đang xử lý, cần người, nhân viên đang xử lý.
- **Chi phí AI và hạn mức tháng** ở một chỗ dễ thấy (KP Chat 1 có bảng chi phí trong tab Chatbot đang ẩn).
- **Tạo đơn ngay trong chat:** KP Chat 1 chỉ đọc đơn, quy ước hiện nay là không ghi vào KiotViet. Chỉ làm nếu anh muốn, xem Phần 4.

### 2.3 Đề xuất cho nhân viên
1. **Hàng đợi cần người** nổi lên đầu: hội thoại bot chuyển người, kèm lý do và thời gian chờ (việc số 1 của anh).
2. **Mục "Bot đã biết"** trong hồ sơ cột phải: dịp, ngân sách, món quan tâm, địa chỉ, kèm lý do bot đề nghị chuyển giai đoạn. Nhân viên vào là nắm ngay, không hỏi lại khách.
3. **Bot đề nghị chuyển Tình trạng**, nhân viên xác nhận một chạm (qua hàm đổi giai đoạn hiện có).
4. **Nháp một chạm:** gợi ý của bot hiện ngay trên ô soạn, Dùng hoặc Sửa bằng một nút, có phím tắt.
5. **Chi phí và hiệu quả bot** ở đầu trang: số tin bot đã trả lời hôm nay, số chuyển người, chi phí tháng.

### 2.4 Đề xuất cho khách (khung chat trên web, Messenger, Zalo)
1. **Nút trả lời nhanh** sau mỗi câu của bot (ví dụ "Xem giá", "Đặt hàng", "Gặp nhân viên"), giảm gõ chữ, nhất là trên điện thoại. Ở Messenger và Zalo OA dùng nút của kênh nếu kênh cho phép.
2. **Thẻ sản phẩm** có ảnh, giá, nút Đặt hoặc Xem (cần nối KP Shop).
3. **Xin số điện thoại đúng lúc** bằng một ô nhập nhỏ trong khung chat, nói rõ để làm gì, không bắt buộc.
4. **Biết đang nói với ai và khi nào có người:** hiện "Trợ lý tự động" và khi chuyển người thì báo "Nhân viên sẽ trả lời trong khoảng [thời gian]".
5. **Tóm tắt đơn trước khi chốt** để khách xác nhận.
6. **Giữ cuộc chat khi chuyển trang**, hỗ trợ điện thoại, có chỉ báo đang soạn.
7. **Thả cảm xúc hoặc đánh giá hữu ích** sau câu trả lời, làm dữ liệu chấm điểm cho Lớp 5.

### 2.5 Nhãn: đã có, đề xuất tối ưu (không làm lại)
Hiện nhãn là một danh sách phẳng, nhân viên gắn tay, chỉ khác nhau về màu. Trong danh sách em thấy các nhãn như "Chốt", "Không chốt", "Hộp quà" nằm chung một kiểu dù ý nghĩa rất khác nhau (kết quả và món quan tâm). Đề xuất:

1. **Chia nhãn theo vai trò**, mỗi vai trò hiển thị và dùng khác nhau:
   - Kết quả: Chốt, Không chốt (và lý do). Mỗi cuộc chat chỉ một. Dùng để chấm bot và chọn cuộc chat thắng.
   - Quan tâm: món, dịp (hộp quà, sinh nhật, tiệc). Gắn nhiều được.
   - Nguồn: quảng cáo, bài đăng, kênh. Tự gắn.
   - Xử lý: Bot cần người, Khiếu nại, VIP. Hệ thống gắn, nổi bật, không xóa nhầm.
2. **Không gắn kết quả hai lần.** KP CRM đã có giai đoạn Thắng, Thua và lý do mất đơn. Nên để nhãn "Chốt", "Không chốt" lấy theo giai đoạn lead (hoặc ngược lại) thay vì nhân viên gắn ở cả hai nơi. Em chưa kiểm hai bên đang ánh xạ thế nào, cần anh xác nhận trước khi làm.
3. **Bot đề xuất nhãn, nhân viên bấm xác nhận.** Giảm việc gắn tay, hợp với mục tiêu giảm việc cho nhân viên.
4. **Bộ nhãn chuẩn theo thương hiệu**, khoảng 10 đến 15 nhãn; gộp nhãn trùng ý, ẩn nhãn lạ (Quản lý nhãn đã có ghim và nhóm, tận dụng).
5. **Một nơi lưu nhãn.** Hiện KP Chat 1 lưu nhãn theo Pancake, KP Chat 2.0 lưu nhãn riêng. Khi nối KPF phải chốt một nơi và ánh xạ, tránh hai bộ nhãn lệch nhau.
6. **Thống kê theo nhãn** (đã có) thêm cột chuyển đổi: nhãn nào ra số điện thoại, ra lead, ra đơn.

---

## Phần 3. Đề xuất thứ tự làm (đã bỏ phần trùng)

Em xếp theo hướng "đo trước, rồi mới cải thiện", kết hợp thứ tự việc anh đã chọn. Phần đã có ở KP Chat 1 em chỉ nối, không làm lại.

1. **Thước đo sale giỏi và nhật ký kết quả.** Gồm tiêu chí 1.5, bộ 40 câu, chỉ số theo chatbot. Dùng nhãn Chốt và Không chốt làm đáp án.
2. **Việc số 1 của anh: báo nhân viên khi bot chuyển người** (hàng đợi cần người). Nhỏ, dùng được ngay.
3. **Ba cổng nối KPF** (hồ sơ khách, danh mục, ghi lead) với bản giả để thử trước. Thay cho các việc "Nối KP CRM", "Nối KP Shop", "Thu lead có cấu trúc" trong danh sách cũ, vì KP Chat 1 đã có logic thật.
4. **"Bot đã biết gì" và đề nghị chuyển Tình trạng** (Lớp 2) hiển thị ở hồ sơ cột phải.
5. **Gắn kịch bản vào chatbot theo giai đoạn lead**, tuỳ biến theo thương hiệu.
6. **Tối ưu nhãn** (2.5): chia vai trò, bot đề xuất nhãn.
7. **Vòng học từ người sale giỏi:** hàng chờ đề xuất, mẫu thắng, duyệt, thu hồi (Lớp 4).
8. **Tự trả lời theo từng nhóm câu hỏi** khi đạt ngưỡng (1.6).
9. **Giao diện khách:** nút trả lời nhanh, thẻ sản phẩm, ô xin số điện thoại.

## Phần 4. Anh cần quyết
1. **Ai là sale giỏi nhất** để học theo, và cho phép em dùng khoảng 20 đến 30 cuộc chat chốt thành công của họ (em xóa tên, số điện thoại, địa chỉ trước khi lưu).
2. **"Thành công" là gì:** có số điện thoại, có đơn, hay cả hai. Bot sẽ tối ưu theo cái này.
3. **Nhãn Chốt và Không chốt** có phải cùng ý với giai đoạn Thắng và Thua của lead KP CRM không, để em gộp thành một nơi.
4. **Quan hệ giữa KP Chat 1 và KP Chat 2.0:** em đề xuất làm bộ não bot ở KP Chat 2.0 qua ba cổng, rồi cắm vào KPF khi nối. Hay anh muốn đưa thẳng vào KP Chat 1?
5. **Tạo đơn ngay trong chat:** có làm không? KP Chat 1 hiện chỉ đọc đơn và quy ước không ghi vào KiotViet. Nếu có, đơn tạo ở đâu (KP Shop, POS hay KOV).
6. **Tiêu chí 1.5:** anh thêm bớt cho đúng cách anh chấm sale.
