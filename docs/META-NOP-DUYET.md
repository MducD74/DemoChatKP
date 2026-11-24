# Nộp duyệt ứng dụng Meta "KP Chat": danh sách việc và hồ sơ

Soạn ngày 22/11/2026 từ tài liệu chính thức của Meta (đã đọc: app-review chung, hướng dẫn nộp hồ sơ, App Review của Messenger và Instagram, "apps for your own business", "apps for other businesses", Human Agent, Business Verification). Chỗ nào tài liệu không nói thì ghi **[chưa xác minh]**; Meta đổi tên menu và quyền khá thường xuyên, nên trước khi nộp hãy mở lại trang "Submit for review" của ứng dụng và đối chiếu.

## 1. Chọn con đường nộp (quyết định đầu tiên)
Meta chia hai loại, hồ sơ khác nhau:
- **Ứng dụng cho doanh nghiệp của mình** ("Yourself or your own business"): chỉ dùng cho Page và Instagram của chính La Bàn Corp. Hồ sơ nhẹ hơn: trang web là website công ty, **không cần đưa tài khoản đăng nhập thử** cho người duyệt.
- **Ứng dụng cho doanh nghiệp khác** ("Clients"): khi KP Chat phục vụ Page của khách hàng, đối tác khác công ty. Phải quay cả luồng "Đăng nhập Facebook for Business" và việc thiết lập hộp thư, và đưa cách đăng nhập thử.

Đề xuất: **nộp loại "doanh nghiệp của mình" trước** (các Page đã nối thuộc La Bàn Corp và các dự án nội bộ KPF). Nếu sau này KP Chat bán cho khách ngoài thì đổi sang "Clients" và nộp lại. **Việc cần anh Khai chốt:** 4 Page đã nối đều thuộc Business Portfolio của La Bàn Corp hay có Page của người khác?

## 2. Ba cấp: cái nào cần duyệt
| Việc | Cần gì |
|---|---|
| Chỉ người có vai trò trên ứng dụng nhắn thử (đang làm) | Không cần duyệt |
| Khách bất kỳ nhắn vào Page và KP Chat trả lời được | **App Review** cho các quyền bên dưới (Advanced Access) và **Business Verification** |
| Trả lời sau 24 giờ (tối đa 7 ngày) | Thêm tính năng **Human Agent**, cũng qua App Review, và cần đã xác minh doanh nghiệp |

Meta nêu: ứng dụng dùng bởi bất kỳ ai không có vai trò thì phải qua App Review; quyền chưa duyệt chỉ hoạt động với người có vai trò. Quyết định sau khi duyệt xong: "trong vòng một tuần" theo Meta (thực tế có thể lâu hơn, nộp sớm).

## 3. Danh sách quyền xin
| Quyền / tính năng | Dùng làm gì trong KP Chat | Ghi chú |
|---|---|---|
| `pages_messaging` | Nhận tin khách nhắn vào Page và trả lời từ hộp thư KP Chat | Quyền chính |
| `pages_show_list` | Liệt kê Page của người đăng nhập để chọn Page nối | |
| `pages_manage_metadata` | Đăng ký ứng dụng nhận webhook tin nhắn của Page (`subscribed_apps`) | |
| `pages_read_engagement` | Đọc tên, ảnh khách và tải tin cũ của hội thoại | **[chưa xác minh]** có cần xin riêng hay đã nằm trong quyền khác |
| `business_management` | Meta ghi là phụ thuộc của `pages_messaging`, `pages_show_list` | Bắt buộc đi kèm |
| `instagram_basic` | Đọc tên tài khoản Instagram liên kết | Chỉ cần khi nối Instagram |
| `instagram_manage_messages` | Nhận và trả lời tin nhắn Instagram | Chỉ cần khi nối Instagram |
| **Human Agent** (tính năng) | Nhân viên thật trả lời khách sau 24 giờ, tối đa 7 ngày | Xin sau cùng, xem mục 7 |

Cấu hình đăng nhập hiện có (`KP Chat Messenger`) mới có 5 quyền Messenger: `business_management, pages_manage_metadata, pages_messaging, pages_read_engagement, pages_show_list`. Muốn nối Instagram phải thêm `instagram_basic` và `instagram_manage_messages` vào cấu hình (hoặc làm cấu hình thứ hai).

Mỗi quyền xin Advanced Access phải có **ít nhất một lời gọi API thành công trong 30 ngày trước khi nộp** (nút "Request advanced access" mờ cho tới khi Meta ghi nhận, mất tới 2 ngày). Việc: trong lúc còn thử nội bộ, cứ gửi và nhận tin thật bằng Page thử để các quyền đều có lời gọi.

## 4. Việc chuẩn bị trước khi nộp (anh Khai làm, em không làm được thay)
- [ ] **Tên miền cố định HTTPS** cho KP Chat (dự kiến `kpchat.laban.asia`; DNS ở Tenten, không chuyển sang Cloudflare vì email công ty ở Lark: chỉ thêm bản ghi CNAME hoặc A cho tên miền con). Cần cho: App Domains, URI chuyển hướng, webhook, trang chính sách. Đường hầm `trycloudflare.com` không dùng được để nộp.
- [ ] **Trang Chính sách quyền riêng tư** công khai, đúng nội dung KP Chat làm (xem mục 5). Có thể để ở `laban.asia/...`.
- [ ] **Điều khoản dịch vụ** (Meta không nêu bắt buộc nhưng nên có). **[chưa xác minh]** có ô Terms of Service URL hay không.
- [ ] **Hướng dẫn xóa dữ liệu người dùng** (trang hoặc callback). **[chưa xác minh]** Meta có bắt buộc cho loại ứng dụng này không; làm sẵn cho chắc (mục 5).
- [ ] **Biểu tượng ứng dụng 1024x1024**, không có logo hay nhãn hiệu Meta/Facebook/Instagram/Messenger.
- [ ] **Danh mục ứng dụng** (Category) và **Mục đích** ("Yourself or your own business" hoặc "Clients"), **Email liên hệ chính** (nhận thông báo duyệt, dùng hộp thư thường xuyên đọc).
- [ ] **Xác minh doanh nghiệp (Business Verification)**: nối ứng dụng vào Business Portfolio của La Bàn Corp (Settings > Basic > Verification), rồi Business Admin xác minh trong Business Settings > Security Center. Meta không liệt kê giấy tờ trong trang đã đọc, **[chưa xác minh]** nhưng thông thường là giấy đăng ký kinh doanh, địa chỉ, số điện thoại, tên miền công ty. Chưa biết La Bàn Corp đã xác minh chưa: kiểm tra trước, vì có thể mất vài ngày.
- [ ] **Page đã được đăng (published)**: Meta yêu cầu Page nhận tin phải công khai khi duyệt.
- [ ] Ứng dụng chuyển sang chế độ **Đăng/Live** khi cần nhận webhook của người ngoài vai trò (Instagram: webhook chỉ gửi khi ứng dụng đã đăng).
- [ ] Máy chủ chạy thường trực (webhook phải trả 200 trong vài giây; Meta nêu tới 20 giây ở trang Messenger, nhưng nên giữ dưới 5 giây).
- [ ] Hai Page thử riêng, có tin nhắn mẫu, và một tài khoản người dùng thử để quay màn hình (không dùng tài khoản cá nhân thật của khách).

## 5. Nội dung chính sách riêng tư (gợi ý, nhờ pháp chế xem lại)
Trang cần nói rõ (tiếng Việt và tiếng Anh, vì người duyệt đọc tiếng Anh):
1. **Ai thu thập:** La Bàn Corp (ghi tên pháp lý đúng theo giấy đăng ký kinh doanh), thông tin liên hệ, email.
2. **Dữ liệu lấy từ Meta:** mã người dùng theo Page (PSID) và Instagram (IGSID), tên, ảnh đại diện công khai, nội dung tin nhắn khách gửi vào Page/Instagram của công ty và tin công ty trả lời, thời gian gửi. Không lấy bài đăng, danh sách bạn bè hay dữ liệu cá nhân khác.
3. **Mục đích:** hiển thị trong hộp thư để nhân viên tư vấn, chăm sóc khách; thống kê thời gian phản hồi; chatbot **chỉ soạn nháp cho nhân viên duyệt, không tự gửi cho khách**.
4. **Chia sẻ:** không bán dữ liệu; chỉ nhân viên được phân quyền vào kênh mới xem; nhà cung cấp hạ tầng và nhà cung cấp mô hình AI nếu bật chatbot soạn nháp (nêu tên khi chốt).
5. **Lưu trữ và bảo mật:** nơi lưu, mã hóa token, thời gian lưu.
6. **Quyền của khách:** yêu cầu xem, sửa, xóa dữ liệu qua email liên hệ; thời hạn xử lý.
7. **Xóa dữ liệu theo yêu cầu:** khách gửi email kèm tên Facebook/Instagram; công ty xóa hội thoại và hồ sơ liên quan trong số ngày cam kết. **Việc kỹ thuật chưa có:** chức năng xóa toàn bộ dữ liệu của một khách trong KP Chat (cần làm trước khi nộp nếu Meta hỏi).
8. **Ngày cập nhật và cách thông báo thay đổi.**

## 6. Hồ sơ nộp cho từng quyền
Meta yêu cầu: **mỗi quyền một mô tả riêng, không sao chép giữa các quyền**; **mỗi quyền phải có đoạn quay màn hình**, thiếu là không duyệt. Quay màn hình: độ phân giải từ 1080 trở lên, giao diện tiếng Anh nếu được, **không có tiếng**, dùng chuột, thấy rõ người dùng cấp từng quyền. Không đưa thông tin tài khoản cá nhân vào ô đăng nhập thử.

**Chuẩn bị quay (dùng chung):** KP Chat ở bản có tên miền thật; giao diện hộp thư bằng tiếng Việt thì thêm chú thích tiếng Anh bằng phần mềm quay (hoặc đặt tên rõ trên màn hình); tài khoản Facebook thử A (quản trị Page thử) và B (đóng vai khách); Page thử đã đăng; dữ liệu mẫu, không có khách thật.

### 6.1 `pages_show_list` + `business_management` (chọn Page để nối)
- **Mô tả (EN):** "KP Chat is the internal inbox of La Ban Corp. A Page administrator logs in with Facebook Login for Business and grants access. The app calls /me/accounts with pages_show_list to list the Pages the administrator manages, so they can choose which Pages to connect to the inbox. business_management is required as a dependency for Page-level messaging access of Pages owned by a business portfolio."
- **Kịch bản quay (khoảng 1 phút):** (1) Mở KP Chat > Cài đặt > Kênh. (2) Bấm Thêm kênh > Page Facebook và Instagram. (3) Hộp thoại Facebook hiện các quyền và Page được chia sẻ; chọn Page thử, bấm tiếp tục để cấp quyền. (4) Quay về KP Chat, hộp "Chọn Page để nối" liệt kê Page. (5) Chọn Page thử, bấm Nối.

### 6.2 `pages_manage_metadata` (đăng ký nhận tin)
- **Mô tả:** "After a Page is chosen, the app subscribes itself to the Page's webhook (POST /{page-id}/subscribed_apps, field: messages) using this permission, so that messages sent to the Page are delivered to the inbox. We do not post to or modify the Page's content or settings."
- **Kịch bản:** tiếp theo 6.1: sau khi Nối, thẻ kênh hiện "đã đăng ký nhận tin"; mở Cài đặt > Kênh > Chi tiết Page, bước "Đăng ký nhận tin" đã xong; chạy "Kiểm tra cài đặt Meta" thấy Page "sẵn sàng nhận tin".

### 6.3 `pages_messaging` (quyền chính)
- **Mô tả:** "Customers message the company's Facebook Page. KP Chat receives these messages by webhook and shows them in a shared inbox where trained staff members read them and reply manually. Replies are sent with the Send API (POST /{page-id}/messages, messaging_type RESPONSE) only within 24 hours of the customer's last message. The app does not send bulk or promotional messages, and does not message people who have not written to the Page first. An optional AI assistant only drafts a reply that a staff member must review before it is sent."
- **Cách người duyệt thử:** nêu rõ: "Message the test Page from any Facebook account; the message appears in the inbox within seconds; reply in the inbox; the reply is delivered in Messenger." Cung cấp tên Page thử và đường dẫn Messenger của Page. Nếu chọn loại "Clients": đưa tài khoản đăng nhập thử (Meta cho chọn Facebook Login for Business hoặc tên đăng nhập và mật khẩu thử, **không dùng tài khoản cá nhân**) và địa chỉ KP Chat; nếu hộp thư đang khóa bằng khóa truy cập thì cho người duyệt đường vào riêng.
- **Kịch bản quay (khoảng 2 phút):** (1) Từ tài khoản B, nhắn vào Page thử trên Messenger (màn hình Messenger thật). (2) Tin hiện ở KP Chat > Hội thoại, có tên và ảnh khách. (3) Nhân viên gõ trả lời và bấm Gửi. (4) Quay lại Messenger của B: thấy tin trả lời. (5) Cho thấy ô soạn bị khóa khi quá 24 giờ (hội thoại cũ). (6) Cho thấy tin gửi bị **hủy gửi/unsent** hiển thị ra sao (Meta hỏi ở bước kịch bản Instagram; quay thêm cho Messenger nếu được). (7) Cho thấy chatbot chỉ hiện nháp và cần bấm "Dùng" của nhân viên.

### 6.4 `pages_read_engagement` (nếu Meta đòi xin riêng)
- **Mô tả:** "Used to read the name and profile picture of the person who messaged the Page (GET /{psid}?fields=name,profile_pic) and to load earlier conversations of the Page (GET /{page-id}/conversations) so the staff member sees the context of the chat."
- **Kịch bản:** mở một hội thoại, chỉ tên và ảnh khách hiện ra; bấm "Tải tin cũ" ở Chi tiết Page và thấy lịch sử xuất hiện.

### 6.5 `instagram_basic` + `instagram_manage_messages`
- **Mô tả `instagram_basic`:** "Read the username of the professional Instagram account linked to the connected Page, to show which Instagram account an inbox channel belongs to."
- **Mô tả `instagram_manage_messages`:** "Customers send direct messages to the company's Instagram professional account. KP Chat receives them by webhook and staff reply from the shared inbox using POST /{page-id}/messages (linked Page). Replies are manual, within the allowed window." Meta hỏi thêm: cách thử, dữ liệu dùng thế nào, **cách bắt đầu một cuộc trò chuyện** (khách nhắn trước vào tài khoản Instagram), có hộp thư riêng không (**có**: KP Chat là custom inbox) và trải nghiệm tự động nếu có phải phản hồi trong 30 giây (KP Chat không tự trả lời; nói rõ).
- **Kịch bản quay:** như 6.3 nhưng bắt đầu bằng đăng nhập chọn cả Instagram liên kết ở hộp "Chọn Page để nối"; nhắn từ tài khoản Instagram thử vào tài khoản chuyên nghiệp; trả lời từ KP Chat; hiện trong ứng dụng Instagram; cho thấy tin hủy gửi (unsent) hiển thị.

## 7. Human Agent
- **Điều kiện:** cần đã xác minh doanh nghiệp; xin qua App Review (Requests > Request Permissions or Features). Meta: chỉ xin khi có hộp thư riêng xử lý chuyển giao cho nhân viên thật **và** nhân viên cần tới 7 ngày để trả lời. Mô tả phải giải thích **vì sao nhân viên cần tới 7 ngày thay vì 24 giờ**.
- **Mô tả (EN):** "Our sales and customer-care staff work in shifts and cannot always reply within 24 hours (weekends, public holidays such as Tet, and complex enquiries that need checking with suppliers or operations, for example tour and booking details). Replies after 24 hours are written and sent manually by a human staff member from the inbox, only to customers who wrote to the Page in the last 7 days, and only about the customer's own enquiry (no advertising or promotion). The tag is never used by the chatbot or by any automated sending: the code refuses automated sends outside the 24-hour window. When the feature is used the inbox reminds the agent of these rules."
- **Kịch bản quay (khoảng 1 phút, có thể dùng chung video 6.3 nếu nộp cùng):** (1) Hội thoại có tin khách cách đây 2 ngày (tạo bằng cách lùi giờ tin trên Page thử hoặc chờ thật). (2) Ô soạn tin mở và hiện dòng nhắc "chỉ nội dung hỗ trợ, không quảng cáo". (3) Nhân viên gõ trả lời, bấm Gửi. (4) Tin tới Messenger của khách. (5) Hội thoại cách 8 ngày: ô soạn bị khóa. (6) Nháp chatbot ở hội thoại quá 24 giờ: không có.
- **Trong KP Chat:** đã viết sẵn, **tắt mặc định**. Khi Meta duyệt thì đặt `META_HUMAN_AGENT=1` trong `.env.local` và khởi động lại. Chưa duyệt mà bật thì Meta từ chối tin và KP Chat hiện lỗi nguyên văn.
- **[chưa xác minh] dạng gửi:** trang Meta đã đọc không có ví dụ JSON; KP Chat gửi `messaging_type: "MESSAGE_TAG"` và `tag: "HUMAN_AGENT"` theo hiểu biết đã có. Phải thử một tin thật ở Page thử ngay khi được cấp quyền. Cũng **[chưa xác minh]** chế độ phát triển có dùng thử được trước khi duyệt không, và Instagram dùng chung dạng này (Meta ghi thẻ này "bắt buộc" cho Instagram Messaging API khi gửi ngoài cửa sổ).

## 8. Thứ tự làm đề xuất
1. Chốt loại ứng dụng (mục 1) và kiểm tra La Bàn Corp đã xác minh doanh nghiệp chưa. Bắt đầu xác minh sớm vì lâu nhất.
2. Tên miền cố định + máy chủ chạy thường trực (đang là việc kiến trúc online riêng: `docs/KIEN-TRUC-ONLINE.md`).
3. Viết và đăng chính sách riêng tư, điều khoản, trang xóa dữ liệu; làm biểu tượng.
4. Thêm quyền Instagram vào cấu hình đăng nhập; chạy thử Instagram thật (`docs/KET-NOI-META.md` phần 4) để có lời gọi thành công cho từng quyền.
5. Quay màn hình theo mục 6 trên bản có tên miền thật.
6. Nộp quyền Messenger + Instagram. Chờ duyệt (khoảng một tuần theo Meta).
7. Xin Human Agent (cùng đợt hoặc sau), khi được duyệt thì bật `META_HUMAN_AGENT=1` và thử một tin.
8. Sau khi duyệt: chuyển ứng dụng sang Live, kiểm tra khách ngoài vai trò nhắn được.

## 9. Việc kỹ thuật còn lại trước khi nộp
- Chức năng xóa dữ liệu của một khách theo yêu cầu (mục 5.7).
- Màn hình hoặc hướng dẫn cho người duyệt vào KP Chat (hiện KP Chat khóa bằng khóa truy cập và công tắc người dùng thử, chưa có đăng nhập thật; Meta cần cách để người duyệt xem được luồng). Nếu chọn loại "doanh nghiệp của mình" thì quay video là đủ, không cần cho vào.
- Hàng đợi xử lý webhook và máy chủ thường trực.

## 10. Chưa xác minh (tổng hợp)
- Giấy tờ Business Verification chính xác, thời gian xác minh.
- Quyền `pages_read_engagement`, `pages_manage_metadata` có cần xin Advanced Access riêng không (trang Meta đã đọc không liệt kê).
- Có bắt buộc URL điều khoản và hướng dẫn xóa dữ liệu không.
- Data Use Checkup hằng năm (không thấy trong trang đã đọc).
- Con đường Tech Provider / Access Verification (chưa đọc), cần nếu sau này phục vụ doanh nghiệp khác.
- Dạng gửi Human Agent trong Send API.

Nguồn đã đọc (developers.facebook.com): `/docs/app-review`, `/docs/resp-plat-initiatives/individual-processes/app-review/submission-guide`, `/documentation/business-messaging/messenger-platform/app-review`, `/documentation/business-messaging/instagram-messaging/app-review` và hai trang con "apps-for-your-own-business", "apps-for-other-businesses", `/docs/features-reference/human-agent`, `/docs/development/release/business-verification`.
