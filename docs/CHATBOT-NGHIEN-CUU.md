# Chatbot cho KP Chat 2.0: nghiên cứu trước khi làm

Ngày 21/11/2026. Mục đích: hiểu chatbot đang có ở KP Chat 1.1, cách các hệ thống khác làm, luật của từng kênh, rồi mới chốt thiết kế và cách thử. **Chưa viết mã chatbot cho 2.0.** Điều chưa xác minh được ghi rõ ở mục 6.

> Cập nhật 22/11/2026: bản soạn nháp đã làm, xem mục Chatbot trong `docs/KE-HOACH-2.0.md`.

## 1. KP Chat 1.1 đang có gì (đã đọc mã `chat-bot.ts`, `chat-actions.ts`, `DE-XUAT-KP-CHAT.md` mục 5)

- **Nấc 1, đang ẩn (`SHOW_BOT = false`):** AI chỉ **soạn nháp** cho nhân viên duyệt, không tự gửi. Nhân viên bấm "dùng nháp" hoặc "bỏ nháp"; hệ thống ghi nhật ký có dùng hay không.
- Mô hình Claude Haiku 5.5 (mặc định) hoặc Sonnet 5.5; ước tính khoảng 65 đồng một hội thoại 6 lượt bằng Haiku (ước tính, chưa đo).
- **Một công cụ duy nhất:** `tim_san_pham` tra giá bán lẻ và còn hàng từ danh mục KP Shop. Prompt bắt buộc dùng kết quả công cụ, cấm đoán giá, cấm báo giá sỉ, chiết khấu, công nợ, giờ giao, chính sách đổi trả. Nội dung khách là dữ liệu, không phải lệnh (chống tiêm lệnh).
- Định dạng trả về: tin sẵn sàng gửi, kèm dòng "Ghi chú cho nhân viên" nếu có.
- Giới hạn tần suất theo người (số lần gợi ý trong 10 phút), nhật ký 300 lần gần nhất có token và chi phí, cài đặt bật/tắt, chọn mô hình, quy tắc riêng tối đa 1.500 ký tự.
- Thiết kế đầy đủ trong `DE-XUAT-KP-CHAT.md` mục 5: 3 nấc (gợi ý, tự trả lời hẹp, tự trả lời theo giờ), 7 công cụ dự kiến, luật chuyển người cứng, hạn mức chi phí, nhật ký rà soát. **Mới viết nấc 1.** Nấc 2 và 3 chưa có mã.
- **Điều 1.1 không làm được và 2.0 làm được:** 1.1 đọc qua Pancake nên không biết nhân viên vừa trả lời ngoài KPF và không có lịch sử tin riêng. 2.0 nhận cả tin đi (echo) và lưu toàn bộ tin, nên bot biết khi người đã vào cuộc và đo được chất lượng.

## 2. Các hệ thống khác làm thế nào (nguồn ngoài, chưa tự thử)

| Hệ thống | Cách làm đáng học | Nguồn |
|---|---|---|
| **Chatwoot** | Hai chế độ: *Trợ lý* trả lời khách từ kho kiến thức rồi chuyển người khi cần; *Copilot* soạn nháp, tóm tắt, gợi ý nhãn cho nhân viên (tương ứng nấc 1 của ta). Cấu hình ở một nơi: nguồn kiến thức, rào chắn (guardrails), luật chuyển người. **Bot nối vào kênh thì hội thoại mới vào ở trạng thái "đang chờ" (pending)**: bot phân loại trước, rồi mới chuyển cho người. Tự đóng hội thoại theo thời gian cấu hình. Chia khách mặc định là xoay vòng giữa người đang rảnh. | [Captain](https://www.chatwoot.com/blog/captain-custom-instructions), [Agent Bots](https://www.chatwoot.com/docs/product/others/agent-bots/), [xoay vòng](https://chatwoot.com/docs/product/inbox/routing-conversations-round-robin) |
| **Intercom Fin** | Chuyển người **kèm đầy đủ lịch sử và những gì bot đã thử**, nhân viên không bắt đầu lại từ đầu. Fin có thể dừng giữa chừng để hỏi đồng nghiệp rồi làm tiếp. Việc cần hành động (đổi trạng thái đơn, hoàn tiền) viết thành *Procedures* có thứ tự, có điểm chuyển người. Tính tiền theo **kết quả giải quyết xong** ($0,99/kết quả, theo trang giá của hãng), không tính khi chỉ chuyển người. | [Fin](https://www.intercom.com/ai-chatbots), [giá](https://fin.ai/pricing) |
| **ManyChat, GoHighLevel, n8n (mẫu Messenger)** | Vấn đề chung mọi người gặp: **bot vẫn trả lời chồng lên khi nhân viên đã tự nhắn**, nhất là khi nhân viên trả lời ngoài hệ thống (app Instagram, app Facebook). Cách xử: phát hiện tin do trang gửi rồi **tạm dừng bot một khoảng** (mẫu n8n mặc định 60 giây), hoặc nhân viên bấm nhận hội thoại thì bot dừng. Cộng đồng ghi nhận trả lời ngoài hệ thống khó phát hiện nếu không nhận tin echo. | [ManyChat](https://community.manychat.com/general-q-a-43/how-to-pause-automations-when-human-agents-reply-via-instagram-app-6078), [GoHighLevel](https://ideas.gohighlevel.com/conversation-ai/p/automatically-stop-ai-responses-once-a-manual-response-is-entered), [n8n](https://n8n.io/workflows/11920-smart-human-takeover-and-auto-pause-ai-powered-facebook-messenger-chatbot/) |
| **Botcake, Pancake, Zalo OA** | Tìm kiếm không ra tài liệu cụ thể. Cần đọc trực tiếp trang hướng dẫn của họ hoặc thử. | chưa có |

**Bài học chính từ các hệ thống trên:**
1. Bot và người **không được cùng trả lời một hội thoại**. Cần trạng thái rõ ràng và luật dừng bot khi người vào cuộc, kể cả khi người trả lời ngoài hệ thống.
2. **Chuyển người phải mang theo ngữ cảnh** (bot đã nói gì, đã tra gì, vì sao chuyển).
3. Bot nên **đứng trước hàng chờ** (trạng thái "đang chờ"), không phải đè lên hàng của nhân viên.
4. Đo bằng **kết quả** (giải quyết xong, chuyển người, bị sửa), không chỉ đếm tin.
5. Có hai mức tách bạch: *trợ lý cho nhân viên* (soạn nháp) và *trả lời thay nhân viên*. Nhiều đơn vị dừng ở mức đầu rất lâu.

## 3. Luật của kênh ảnh hưởng đến bot

| Kênh | Điều đã biết | Mức chắc chắn |
|---|---|---|
| **Messenger, Instagram** | Trả lời tiêu chuẩn trong **24 giờ** kể từ tin cuối của khách (đã xác minh ở tài liệu Meta, đã làm trong adapter). Thẻ gửi ngoài cửa sổ đã đổi từ 27/04/2026 (CONFIRMED_EVENT_UPDATE, ACCOUNT_UPDATE, POST_PURCHASE_UPDATE trả lỗi 100). Thẻ Human Agent kéo dài 7 ngày **chỉ cho người thật trả lời**, không dành cho bot trễ. | Tài liệu Meta (đã đọc): chắc. Chuyện bot phải tự giới thiệu là bot, phải có đường chuyển người: **chỉ từ bài blog bên thứ ba**, nguồn chính thức chưa tìm thấy |
| **Zalo OA** | Tin Tư vấn trong **7 ngày** kể từ lần tương tác cuối, miễn phí trong 48 giờ (đã xác minh). Quy định riêng về bot trả lời tự động: **chưa tìm** | Chưa rõ |
| **TikTok** | Tối đa **10 tin trong 48 giờ** sau tin của khách; khách phải nhắn trước; API đang thử nghiệm mở (đã xác minh). Quy định riêng về bot: **chưa tìm** | Chưa rõ |
| **WhatsApp** (nếu thêm sau) | Chính sách Meta từ 2026 cấm bot đa năng và yêu cầu đường chuyển người rõ ràng (nguồn bên thứ ba). Chưa liên quan vì ta chưa có kênh này | Chưa xác minh |

Kết luận tạm: bot **an toàn về luật** khi (a) chỉ trả lời trong cửa sổ, (b) nói rõ là trợ lý tự động ở câu đầu, (c) luôn có đường gặp người. Cần tra tài liệu chính thức của Meta, Zalo, TikTok về bot trước khi bật tự trả lời cho khách thật.

## 4. Đề xuất thiết kế cho 2.0 (để anh duyệt, chưa làm)

**Trạng thái bot của từng hội thoại** (lưu trong hội thoại): `tắt` | `nháp` (bot soạn, người duyệt) | `tự trả lời` | `tạm dừng` (người đã vào cuộc) | `đã chuyển người` (kèm lý do).

**Cấu hình theo từng kênh** (mục Cài đặt > Chatbot): chế độ `Tắt / Soạn nháp / Tự trả lời`, khi nào tự trả lời (ngoài giờ làm việc, hoặc chưa ai nhận sau N phút), nút tắt khẩn cấp ở đầu trang, hạn mức theo ngày và theo hội thoại.

**Luật dừng bot (viết thành mã, không chỉ nhờ lời nhắc):**
1. Có người nhận hội thoại hoặc **tin đi do người gửi** (echo Meta, `im_send_msg` TikTok, `oa_send_*` Zalo khi làm xong) thì bot tạm dừng.
2. Khách xin gặp người, giá sỉ, công nợ, khiếu nại, đặt/đổi/hủy đơn, gửi ảnh hay tệp bot không đọc được, công cụ lỗi, mô hình từ chối, hỏi lại cùng ý sau 4 lượt thì chuyển người.
3. Quá cửa sổ trả lời của kênh thì bot im.

**Chuyển người có ngữ cảnh:** ghi chú nội bộ tự tạo ("bot đã tra gì, đã nói gì, vì sao chuyển") đặt ngay trong hội thoại, hội thoại về hàng "chưa nhận" cho xoay vòng.

**Công cụ:** giữ `tim_san_pham` của 1.1, thêm lần lượt `chinh_sach` (trang kiến thức do nhân viên soạn, duyệt tay), `chuyen_nguoi`, `ghi_lead`. Mọi hành động có hậu quả đều là "chuyển người", bot không có công cụ ghi vào hệ thống khác.

**Đo kết quả (có thể làm ngay vì 2.0 lưu toàn bộ tin):** tỷ lệ nháp được dùng nguyên, dùng sau khi sửa, bỏ; tỷ lệ chuyển người và lý do; tỷ lệ nhân viên bấm Sai/Nguy hiểm; chi phí.

## 5. Cách thử an toàn (đề xuất thứ tự, anh chưa test nên đây là phần quan trọng nhất)

1. **Chế độ bóng (shadow):** bot soạn nháp **âm thầm** cho mọi tin khách, **không hiện cho nhân viên và không gửi**. Sau vài ngày so nháp của bot với câu nhân viên thật sự trả lời. Đo mức giống, mức sai, câu nào bot nên chuyển người. Không rủi ro với khách.
2. **Bộ câu hỏi mẫu:** lấy 30 đến 50 hội thoại thật (đã ẩn tên, số điện thoại) để chạy lại mỗi lần đổi lời nhắc hoặc công cụ. Cần anh cung cấp hoặc cho phép xuất từ lịch sử.
3. **Nấc nháp có người duyệt:** hiện nháp trong ô soạn cho nhân viên, theo dõi tỷ lệ dùng nguyên.
4. **Tự trả lời hẹp, một kênh thử, chỉ ngoài giờ,** chỉ nhóm câu đã duyệt, có nút tắt khẩn. Chỉ nâng nấc khi tỷ lệ sai đã đo được ở mức anh chấp nhận.

## 6. Chưa biết, cần xác minh hoặc anh quyết

- **Chính sách chính thức** của Meta (Messenger, Instagram), Zalo OA, TikTok về bot tự trả lời (có bắt tự giới thiệu là bot không, có yêu cầu chuyển người không). Em chưa đọc được nguồn chính thức.
- **Cách Botcake và Pancake làm** (bot dừng khi nhân viên trả lời thế nào, luồng kịch bản). Cần đọc tài liệu của họ hoặc anh cho xem thử.
- **Nội dung kiến thức bot:** chính sách giao hàng, đổi trả, thanh toán, giờ làm việc, tên gọi sản phẩm của KPF LBF và KP Travel khác nhau. Mỗi dự án cần một trang kiến thức do người của dự án soạn. Anh cho biết ai soạn.
- **Dữ liệu thật để thử:** lịch sử chat đã ẩn danh của từng dự án (đặc biệt KP Travel: tour, giá thay đổi theo ngày, đặt chỗ cần người) vì bot cho du lịch khó hơn bán lẻ rất nhiều (giá theo ngày, còn chỗ, hành khách). Cần quyết bot du lịch chỉ tư vấn chung rồi chuyển người, hay có tra giá thật.
- **Ngân sách:** hạn mức tiền mỗi ngày, mỗi tháng cho từng dự án.
- **Nhân viên và khách có cần biết đang nói chuyện với bot:** đề xuất có, ở câu đầu, theo thông lệ của các nền tảng.
