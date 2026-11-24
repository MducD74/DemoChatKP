# Hồ sơ xin quyền TikTok Business Messaging API (bản nháp, anh sửa cho đúng thực tế trước khi nộp)

Nguồn điều kiện: xem mục "TikTok: điều kiện truy cập" trong `KE-HOACH-2.0.md`. TikTok duyệt thủ công, nên mọi câu trả lời phải **đúng sự thật**. Chỗ có dấu `[...]` là thông tin tôi không biết, anh điền.

## 1. Đăng ký nhà phát triển, bước 2 "Thông tin bổ sung"
| Mục | Gợi ý |
|---|---|
| Tên công ty | `[tên pháp lý, ví dụ La Bàn Corp]` |
| Trang web công ty | `[website chính thức của công ty]` |
| Địa điểm nhà phát triển chính | Vietnam |
| Bạn cung cấp những dịch vụ gì? | chọn mục gần nhất với phần mềm chăm sóc khách hàng / quản lý hội thoại (nếu có) |
| Bạn chuyên về lĩnh vực nào? | `[ví dụ: bán lẻ, F&B, du lịch]` |
| 5 khách hàng hàng đầu | Đây là công cụ nội bộ: ghi các thương hiệu của chính công ty, ví dụ XuXi Fruit, XuXi Drink, TixGo `[và các thương hiệu khác]` |
| Bạn phục vụ khu vực nào? | Vietnam (APAC) |
| Doanh thu từ TikTok (USD) | `[số thật; nếu chưa có thì 0]` |

## 2. Mô tả cách dùng API (tiếng Anh, dán vào ô cuối của bước 2)
> `[Company]` operates consumer brands in Vietnam (`[brand names]`) and handles customer support through social messaging channels. We are building an in-house shared inbox called KP Chat so that our own customer-care staff can read and reply to direct messages sent to our own TikTok Business accounts, in the same place as our Messenger and Zalo conversations.
>
> We will use the TikTok Business Messaging API only for TikTok accounts that our company owns and authorizes. Specifically we will: (1) receive a webhook notification when a TikTok user starts a conversation with one of our accounts; (2) read the messages in that conversation; and (3) reply to that same conversation using its conversation_id, with text or an image, written by our staff.
>
> We will not start conversations with users who have not messaged us first, we will not send bulk or promotional messages, and we will respect TikTok's messaging limits. Access tokens are stored encrypted, each staff member can only open the accounts they are assigned to, and messages are kept only to provide customer support. We do not sell or share this data with third parties and do not use it for advertising.

## 3. Mô tả bảo mật thật của KP Chat (dùng cho bảng câu hỏi thẩm định DSPR DDQ)
Đây là hiện trạng ngày 22/11/2026. **Đang chạy trên máy cá nhân, chưa online**; trả lời bảng câu hỏi khi đã lên máy chủ thì cập nhật lại.
- Token và phiên của các kênh mã hoá AES-256-GCM, khoá riêng `KPCHAT_SECRET_KEY` đặt ở máy chủ, không nằm trong mã hay nhật ký; giao diện không bao giờ nhận được token.
- Phân quyền theo kênh (Nhắn tin, Chỉ xem), quản trị và nhân viên tách vai trò; nhân viên chỉ thấy hội thoại của mình và hội thoại chưa nhận ở kênh được gán.
- Webhook kiểm chữ ký; khi mở ra mạng công khai có khoá truy cập, trừ webhook và ảnh có tên ngẫu nhiên.
- Dữ liệu hội thoại hiện lưu trong tệp `data/chat.json` trên máy chủ chạy ứng dụng (kế hoạch chuyển sang Supabase, xem `KE-HOACH-DATABASE.md` bên KPF). Chưa có mã hoá dữ liệu hội thoại khi lưu và chưa có nhật ký truy cập.
- **Chưa có**: chứng chỉ ISO 27001, báo cáo SOC 2, kiểm thử xâm nhập, chính sách bảo mật đã công bố, quy trình xoá dữ liệu theo yêu cầu. Nên chuẩn bị chính sách riêng tư và điều khoản trước khi nộp.
- Không bán hay chia sẻ dữ liệu cho bên thứ ba. Chatbot (nếu làm) sẽ chỉ soạn nháp cho nhân viên duyệt; chưa quyết định dùng nhà cung cấp mô hình nào, nếu dùng sẽ phải khai báo trong bảng câu hỏi.

## Tiến độ (cập nhật 22/11/2026)
- Đăng ký nhà phát triển TikTok: **đã nộp**, TikTok xét trong tối đa 3 ngày. Đã điền: La Bàn Corp, labancorp.vn, Vietnam, dịch vụ "Tài khoản", lĩnh vực FMCG, Bán lẻ, Du lịch, khu vực APAC, mô tả tiếng Anh như mục 2 ở trên.
- Ứng dụng **KP Chat** trên business-api.tiktok.com đã tạo, trạng thái xác minh **"Đang chờ xử lý"**, App ID và khoá bí mật chưa có (hiện "--" cho đến khi TikTok duyệt). Quyền đã xin: "Quản lý tài khoản quảng cáo" và "Đo lường" (theo tài liệu TikTok yêu cầu khi xin quyền tin nhắn; chưa xác định được mục "CTX Events" trong danh sách nên chưa chọn). Danh sách quyền trong biểu mẫu không có mục tin nhắn riêng, quyền tin nhắn được cấp sau đánh giá bảo mật.
- URL chuyển hướng đã điền tạm: `https://kpchat.laban.asia/api/connect/tiktok/callback` (tên miền chưa dựng; cần đổi bằng địa chỉ thật khi có, chưa kiểm chứng TikTok có cho sửa sau khi tạo).
- Còn lại: chờ TikTok duyệt đơn và ứng dụng; sau đó nộp biểu mẫu Data security & privacy review (anh nộp); tài khoản TikTok cần nối phải là Verified Business Account.
- Lưu ý khi thao tác trên cổng TikTok: tắt dịch tự động của Chrome (trang chỉ có tiếng Anh và tiếng Trung), nếu không trang hay sập với "client-side exception".

## Biểu mẫu Data Security and Privacy Review Intake (form Lark của TikTok, anh tự điền, CHƯA nộp được)
Địa chỉ: mở từ trang tài liệu "Access to Business Messaging API" > liên kết "this form" (`bytedance.my.larkoffice.com/share/base/form/shrlg7vFArGhg9V20neYCEwIKrb`). **Mục 9 cần App ID, mà App ID chỉ có sau khi TikTok duyệt hồ sơ doanh nghiệp (ứng dụng "KP Chat" đang "Đang chờ xử lý"). TikTok dặn chưa gửi form cho tới khi có App ID hợp lệ.** Không nộp nhiều lần.
| # | Mục | Điền |
|---|---|---|
| 1 | Developer Company | `La Bàn Corp` |
| 2 | Company Legal Entity Name | tên pháp lý **đúng như trên giấy phép kinh doanh** `[anh điền]` |
| 3 | Headquarters Location | `[thành phố, Vietnam của trụ sở]` |
| 4 | Website URL | `https://labancorp.vn` |
| 5 | Contact Person's Name | họ tên pháp lý người liên hệ về bảo mật dữ liệu `[anh điền]` |
| 6 | Contact Person's Email | email cá nhân đuôi tên miền công ty (không dùng email chung hay Gmail) `[anh điền]` |
| 7 | TikTok Representative's Email | bỏ trống nếu không làm việc với đại diện TikTok |
| 8 | Mô tả đơn | chọn "This is my first time applying for Business Messaging API access." |
| 9 | Developer App ID | **App ID của ứng dụng KP Chat, lấy ở business-api.tiktok.com/portal/apps sau khi được duyệt** |
| 10 | Managed Business Account Regions | chọn **APAC** (không chọn United States, tránh thêm đánh giá bảo mật Mỹ) |
- Sau khi nộp: TikTok gửi email "TikTok/ByteDance Third-Party Due Diligence Questionnaire" (DSPR DDQ) tới email ở mục 6. Trả lời bằng mục 3 của tài liệu này và đính kèm bằng chứng bảo mật nếu có.
- Ghi chú: tài liệu TikTok nói ứng dụng xin quyền tin nhắn nên có các quyền "Quản lý tài khoản quảng cáo", "Quản lý sự kiện CTX" và "Đo lường". Lúc tạo ứng dụng mới chọn hai quyền đầu và Đo lường; còn "Quản lý sự kiện CTX" tìm ở phần dưới của danh sách quyền trong "Update app permissions" khi có App ID.
