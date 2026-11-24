# KP Chat 2.0: kế hoạch

Mục tiêu: hộp thư chat nhiều kênh tự nối thẳng Facebook (Messenger, Instagram), Zalo OA, TikTok. Dùng được trong KPF LBF, KP Travel, KPF AI qua adapter mỏng.

## Kiến trúc
```
Kênh -> webhook -> Gateway (xác thực chữ ký, lưu raw, trả 200 nhanh)
     -> Hàng đợi -> Normalizer (conversation/message/contact/attachment)
     -> Lõi: hộp thư, gán, nhãn, ghi chú, mẫu, thống kê, (SLA, bot sau)
     -> Host adapter (mỗi KPF một bản): auth, quyền, công ty, CRM, nhiệm vụ
```
- Kênh là adapter cùng giao diện: `verify`, `parse`, `send`, `refreshToken`. Ba adapter: meta, zalo-oa, tiktok.
- Dữ liệu tách theo `companyId`; ban đầu lưu local (SQLite hoặc JSON), thiết kế sẵn để chuyển Supabase.

## Lộ trình
1. Giao diện host adapter + bản host giả để chạy độc lập.
2. Gateway webhook + hàng đợi + chống trùng; thử với payload mẫu.
3. Adapter Meta (Messenger, Instagram) với page thử.
4. Adapter Zalo OA (xin duyệt quyền, tự làm mới token).
5. Adapter TikTok.
6. Ảnh sang storage, sao lưu, SLA, chatbot.
7. Đóng gói và cắt chuyển từng kênh vào từng KPF.

## Cần kiểm trước khi viết adapter
- Điều kiện Meta App Review và quyền gửi tin Zalo OA; nộp sớm.
- Zalo cá nhân và TikTok: có API chính thức dùng được không.
- Cửa sổ trả lời: Messenger 24 giờ; Zalo OA 7 ngày kể từ lần tương tác cuối (đã xác minh), TikTok 48 giờ và tối đa 10 tin sau mỗi tin của khách (đã xác minh).

## Cần anh Khai chốt
1. Vị trí repo (đang đặt cạnh kpf-lbf).
2. Supabase riêng hay dùng chung với tiền tố.
3. Module chép vào từng KPF (như 1.1) hay app dùng chung nhúng vào.

## Ghi chú adapter Meta (đã làm khung, chưa thử với app/page thật)
Đã đối chiếu tài liệu Meta:
- Webhook GET xác minh bằng `hub.verify_token`; POST ký `X-Hub-Signature-256` (HMAC-SHA256 bằng App Secret). Meta ký trên dạng escape unicode (`\uXXXX`), adapter thử cả hai dạng.
- Phải trả 200 trong 5 giây; lỗi kéo dài 1 giờ thì Meta tắt webhook. Vì vậy gateway chỉ nhận và lưu, việc nặng đưa vào hàng đợi (chưa làm).
- Gửi: `POST graph.facebook.com/v27.0/{PAGE_ID}/messages`, `messaging_type`, token để ở header. Trang Instagram liên kết với Page dùng chung endpoint này (recipient là IGSID).
- Cửa sổ chuẩn 24 giờ; tối đa 7 ngày với tin đầu từ quảng cáo Click-to-Messenger/Direct. Thẻ gửi ngoài cửa sổ (CONFIRMED_EVENT_UPDATE, ACCOUNT_UPDATE, POST_PURCHASE_UPDATE) trả lỗi 100 từ 27/04/2026. Thẻ Human Agent 7 ngày chưa kiểm chuỗi thẻ cụ thể, chưa làm.
- Tin echo (`is_echo`) cho biết tin do app khác gửi, adapter lưu thành tin chiều "out".

Chưa xác minh được (trang handover trống/404):
- Nếu một Page đã có app khác nhận tin (vai trò Primary/Secondary), KP Chat có nhận được không. Trang cần đọc: messenger-platform/conversation-routing.
- Endpoint Instagram Login (`graph.instagram.com/.../me/messages`) cho tài khoản không liên kết Page.
- Chưa làm: gửi tệp, đồng bộ lịch sử hội thoại cũ, đăng ký `subscribed_apps` tự động, token mã hóa trong kho (hiện lấy từ biến môi trường `META_TOKEN_<pageId>` khi thử local).

## Ghi chú adapter Zalo OA (đã làm, chưa thử với OA thật)
Đã đối chiếu tài liệu developers.zalo.me (đọc qua trang render trong iframe stc-developers.zdn.vn):
- Webhook POST, `X-ZEvent-Signature` = `sha256(appId + data + timeStamp + OAsecretKey)` (băm thường, không HMAC; `data` là chuỗi JSON nhận được, `timeStamp` lấy từ body). Phải trả 200 trong 2 giây; Zalo gửi lại sau 30 giây, 5, 15, 30 phút, 1 giờ rồi hủy đăng ký webhook nếu vẫn lỗi.
- Sự kiện đã xử lý: `user_send_text/image/link/audio/video/sticker/location/file/business_card` (đính kèm theo `attachments`). Bỏ qua các sự kiện khác.
- Gửi tin Tư vấn: `POST https://openapi.zalo.me/v3.0/oa/message/cs`, header `access_token`, body `recipient.user_id` + `message.text`; ảnh dùng template `media` (một ảnh jpg/png tối đa 1MB mỗi tin). Thành công khi `error = 0`.
- Điều kiện: người dùng tương tác với OA trong 7 ngày; tin gửi trong khung 48 giờ miễn phí không giới hạn từ 1/1/2026, quá 48 giờ có thể tính hạn mức.
- OAuth: `POST https://oauth.zaloapp.com/v4/oa/access_token`, header `secret_key`; access token 25 giờ (`expires_in` 90000), refresh token 3 tháng và **chỉ dùng một lần** (đổi xong cặp mới thay cặp cũ). Adapter: làm mới khi còn dưới 10 phút, chỉ một lượt làm mới mỗi kênh tại một thời điểm, lưu cặp mới ngay (mã hóa AES-256-GCM, khóa `KPCHAT_SECRET_KEY`).

Chưa xác minh / chưa làm:
- Mã lỗi token hết hạn: hiện coi lỗi có chữ "token" là cần làm mới rồi thử lại một lần.
- Tham số PKCE (`code_verifier`) khi đổi authorization code lần đầu; chưa có màn hình cấp quyền (OAuth redirect).
- Sự kiện OA gửi tin (`oa_send_*`) để đồng bộ tin gửi từ app Zalo; API lấy tên và ảnh người dùng (hiện tên hiển thị là id Zalo).
- Gửi tệp, tin giao dịch và truyền thông; kiểm tra hạn mức tin ngoài 48 giờ.
- Biến môi trường để thử: `ZALO_APP_ID`, `ZALO_APP_SECRET`, `KPCHAT_SECRET_KEY`.

## Ghi chú adapter TikTok (đã làm, chưa thử với tài khoản thật)
Đã đối chiếu tài liệu business-api.tiktok.com (v1.3). Điều kiện trước khi chạy được thật:
- Business Messaging API đang **open beta** ở APAC, LATAM, METAP, Bắc Mỹ; **không dùng được** cho tài khoản đăng ký ở EEA, Thụy Sĩ, Anh. Phải tạo developer app, chọn quyền Business Messaging, qua bước duyệt bảo mật dữ liệu của TikTok để được cấp truy cập (tài liệu chưa nói thời gian duyệt).
- Tài khoản TikTok phải là loại Advanced Access hoặc Verified Business, chủ tài khoản trên 18 tuổi, và nên đặt "nhận tin nhắn từ mọi người" trước khi cấp quyền (nếu không phải chấp nhận từng yêu cầu thủ công trong app TikTok).
- Khách phải nhắn trước; shop không chủ động nhắn được.

Đã làm:
- Webhook cấp ứng dụng (đăng ký một lần bằng `/business/webhook/update/`, `event_type: DIRECT_MESSAGE`), sự kiện `im_receive_msg` (tin khách) và `im_send_msg` (tin gửi đi). Chữ ký `Tiktok-Signature: t=...,s=...` = HMAC-SHA256(secret, `t + "." + body`); từ chối nếu timestamp lệch quá 5 phút (chống phát lại).
- Gửi `/business/message/send/` theo `conversation_id` (lõi đã lưu mã hội thoại của kênh). Một tin không được vừa chữ vừa ảnh nên gửi riêng. Chữ tối đa 6.000 ký tự. Ảnh: tải ảnh từ URL, upload `/business/message/media/upload/` (jpg/png, tối đa 3MB) lấy `media_id` rồi gửi.
- Giới hạn: tối đa 10 tin trong 48 giờ sau tin cuối của khách (lõi có kiểm `maxRepliesPerWindow`).
- OAuth: access token 1 ngày, refresh token 1 năm; làm mới trước hạn, một lượt mỗi kênh, lưu mã hóa. `connect(channelId, authCode, redirectUri)` đổi mã cấp quyền và trả `open_id` (dùng làm mã ngoài của kênh và `business_id`).
- Ảnh khách gửi chỉ có `media_id`: lưu tham chiếu `tiktok-media://...`, `resolveMedia` lấy link tải 24 giờ (khi tải phải kèm header `x-user: <access token>`). Chưa có route giao diện hiển thị ảnh này.

Chưa xác minh / chưa làm:
- Mã lỗi token hết hạn và việc `refresh_token` có đổi mỗi lần làm mới không (nếu có trả mới thì lưu, không thì giữ cũ).
- Sự kiện `im_receive_msg_eu` (khách ở EEA/Anh/Thụy Sĩ) chưa xử lý; `im_referral_msg`, `im_receive_high_intent_comment`, Comment-to-Message (có ở Việt Nam, Indonesia, Thái Lan) chưa làm.
- Gửi bài đăng, thẻ Q&A, trạng thái đang gõ, đánh dấu đã đọc; kiểm tra khả năng gửi ảnh của tài khoản (`/business/message/capabilities/get/`); đồng bộ lịch sử hội thoại; màn hình cấp quyền.
- Biến môi trường để thử: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `KPCHAT_SECRET_KEY`.

## Màn hình kết nối kênh (/settings)
- Thêm kênh (Messenger, Instagram, Zalo OA, TikTok); kênh mới luôn **tắt gửi tin**. Instagram cần thêm Page ID của Page liên kết (gửi tin qua Page, nhận webhook theo id Instagram).
- Meta: dán Page access token, hệ thống kiểm với Meta (khớp Page) rồi lưu mã hóa; nút "Đăng ký nhận tin" gọi `subscribed_apps` với trường `messages`.
- Zalo OA: nút cấp quyền sinh PKCE (code verifier lưu mã hóa, state dùng một lần, hết hạn 15 phút), callback `?code&oa_id&state` đổi token và gán oa_id cho kênh.
- TikTok: nút cấp quyền dùng link lấy ở My Apps (`TIKTOK_AUTH_URL`) kèm `state`; callback `?code&state` đổi token và gán open_id; nút đăng ký webhook cấp ứng dụng (cần HTTPS công khai).
- Trang cũng hiện địa chỉ webhook, địa chỉ chuyển hướng và tình trạng cấu hình môi trường; không hiển thị bí mật.
- CHƯA XÁC MINH: định dạng URL cấp quyền Zalo (`oauth.zaloapp.com/v4/oa/permission`) và code challenge dạng base64url; tài liệu nói URL tạo ở Zalo for Developers. Chưa có đăng nhập/phân quyền cho trang này (sẽ qua host adapter).
- Biến môi trường mới: `KPCHAT_PUBLIC_URL`, `TIKTOK_AUTH_URL`.

## Hộp thư hoàn thiện (v1)
- Khóa ghi kho `mutate`: mọi thao tác đọc-sửa-ghi xếp hàng, hết lỗi ghi chồng làm mất tin khi nhiều webhook về cùng lúc (có test 40 tin đồng thời). Vẫn là JSON local, chưa phải hàng đợi.
- Chưa đọc theo từng nhân viên (chấm xanh, số trên tiêu đề tab, chưa đọc lên đầu); lọc "Của tôi / Chưa nhận"; tìm theo tên, nội dung, nhãn.
- Ghi chú nội bộ (nền vàng, không gửi qua kênh, không thành "tin cuối").
- Mẫu trả lời nhanh: quản lý trong hộp thư, gõ `/phimtat` để chèn, biến `{ten_khach}`, `{ten_nhan_vien}`.
- Gửi ảnh (jpg/png tối đa 3MB; Zalo chỉ nhận 1MB): tải lên `data/media`, phục vụ công khai ở `/api/media/<mã 128 bit>`; chỉ nhận ảnh đã tải lên KP Chat khi gửi (tránh SSRF). Cần địa chỉ công khai HTTPS để kênh tải được ảnh.
- Hiển thị ảnh, âm thanh, video, tệp trong khung chat; ảnh TikTok của khách đi qua `/api/inbox/media` (lấy link tạm có token).
- Đếm ngược cửa sổ trả lời của từng kênh và chặn gửi khi quá hạn.
- Chưa làm: phân trang tin nhắn dài, gửi tệp (không phải ảnh), tên và ảnh khách Zalo, phân quyền theo người, thống kê, SLA, chatbot.

## Giao diện theo quy ước KPF / KP Travel (đã làm lại)
- `src/app/kpf-base.css` là bản sao nguyên văn `globals.css` của KPF; `src/components/ui.tsx` sao các thành phần chuẩn (Ic, Chip, Modal, Select, TopTabs, FilterBar, Collapse, ColPicker, usePersist, Kpi) đúng tên và lớp CSS. Khi gắn vào KPF/KP Travel: xóa hai file này và `Shell.tsx`, import của dự án đích; chỉ giữ `chat.css` (tiền tố `.kc-`, lấy từ KP Chat 1.1).
- Một trang "KP Chat", các mục chia bằng `TopTabs`: Hội thoại (số chưa đọc), Tổng quan (admin), Kênh (admin), Mẫu trả lời.
- Hội thoại: bố cục 3 cột như KP Chat 1.1 (danh sách, khung chat, hồ sơ), thêm thời gian chờ trả lời, nhãn dạng chip, nháp riêng từng hội thoại, Enter chọn mẫu khi gõ `/`.
- Tổng quan, Kênh, Mẫu: `FilterBar` (ô tìm bên trái, nút cam `btn cta`), `Collapse` + `strip` ô `stat` bấm lọc, bảng `tw m stick rt`, `Chip`, `Modal`, `Kpi` + `.ov-g*`.
- Kênh: bấm một dòng mở cửa sổ hướng dẫn từng bước (khóa máy chủ, địa chỉ webhook, token hoặc cấp quyền, đăng ký, bật gửi tin) có đánh dấu bước đã xong.

## Vai trò Admin / Nhân viên (chạy thử, quyền kiểm ở máy chủ)
- Admin: thấy và làm mọi thứ, giao hội thoại cho ai cũng được, quản lý kênh, mẫu, xem Tổng quan.
- Nhân viên: chỉ thấy hội thoại của mình và hội thoại chưa nhận; trả lời hoặc ghi chú vào hội thoại chưa nhận thì tự nhận; chỉ nhận về mình hoặc trả lại, không giao cho người khác; không gọi được API kênh, tổng quan, sửa mẫu (403).
- Chọn người dùng thử bằng ô "Đang dùng với tư cách" trên thanh trên (cookie `kp_actor`). Khi gắn vào KPF thay bằng host adapter.
- Bật gửi tin chỉ được khi kênh đã kết nối xong (kênh mẫu `demo-` được miễn).
- CHƯA kiểm bằng mắt: Enter chọn mẫu khi gõ `/` (đã đọc mã, chưa xác nhận trên trình duyệt vì lúc thử có người thao tác cùng lúc); bố cục điện thoại.

## Cài đặt, phân quyền theo kênh, thư viện mẫu (bước 1 và 2)
- Mục Cài đặt (admin) dạng nhóm thu gọn, rộng hết trang: Kết nối kênh, Phân quyền theo kênh (Nhắn tin / Chỉ xem). Các nhóm Chia khách, SLA, Chatbot thêm ở các bước sau.
- Phân quyền theo kênh: nhân viên không có trong kênh thì không thấy gì ở kênh đó; mức Chỉ xem không ghi được; admin chỉ giao hội thoại cho người có mức Nhắn tin; bỏ ai khỏi kênh thì hội thoại họ đang giữ ở kênh đó về "chưa nhận". Kênh chưa chọn ai: chỉ admin thấy.
- Thư viện mẫu: Mẫu trả lời (ký tự tắt, tối đa 6 nội dung gửi lần lượt, mỗi nội dung có chữ và tối đa 5 ảnh, sắp xếp lên xuống) và Thư mục ảnh (thư mục, yêu thích, kéo thả, đổi tên, chuyển thư mục). Xóa ảnh thì gỡ khỏi mẫu đang dùng. Trong hộp thư: gõ `/` chọn mẫu (nội dung đầu vào ô soạn, các nội dung sau xếp hàng gửi tiếp), nút chọn ảnh từ thư mục.
- Chưa làm so với 1.1: xuất/nhập mẫu JSON, yêu cầu kênh nào được dùng mẫu nào.

## Thống kê và SLA (bước 3)
- **SLA không có mặc định**: kênh chưa cài thì không đo, không cảnh báo, các số SLA hiện "Chưa cài". Quản trị cài ở Cài đặt > SLA theo kênh và theo sale: ngưỡng phản hồi (bắt buộc, phút), ngưỡng bỏ lỡ (không bắt buộc), giờ làm việc (không bắt buộc, theo giờ Việt Nam, chọn ngày và giờ), ngưỡng riêng từng sale (ghi đè ngưỡng kênh).
- Đo từ lịch sử tin đã lưu (không cần tiến trình nền): "lượt chờ" = từ tin đầu của khách chưa được trả lời đến tin trả lời đầu tiên. Phiên mới nếu im lặng quá 4 giờ. Ghi chú nội bộ không tính là trả lời. Tin gửi từ ứng dụng ngoài KP Chat (không biết người gửi) tính cho người phụ trách hội thoại.
- Chỉ số: đạt SLA (trả lời trong ngưỡng ÷ đã trả lời + chưa trả lời mà đã quá ngưỡng), phản hồi đầu trung bình, các lượt trả lời sau, bỏ lỡ (khách chờ quá ngưỡng bỏ lỡ), thời gian nhận khách (từ tin đầu đến lúc được giao hoặc nhận).
- Tab Thống kê: kỳ xem, kênh, nhân viên; thẻ số liệu; bảng theo kênh, theo nhân viên, SLA từng người theo từng kênh, kênh × nhân viên đang mở, nhãn, tin khách theo ngày. Admin thấy tất cả; nhân viên chỉ thấy số của mình (máy chủ ép, bỏ qua tham số staff).
- Cảnh báo: "sắp vượt" khi đã chờ từ 80% ngưỡng, "vượt SLA" khi quá ngưỡng; hiện ở danh sách Hội thoại, Tổng quan (thẻ, cảnh báo, bảng cần xử lý ngay xếp vượt SLA lên đầu).
- Chưa làm: thông báo đẩy khi sắp vượt SLA, đưa số vào KPI của KP CRM/KP HRM, thống kê "bỏ lỡ" theo khung giờ, xuất file.

## Chia khách (bước 4)
- Cấu hình theo từng kênh ở Cài đặt > Chia khách, không có mặc định (chưa đặt = nhân viên tự bấm Nhận khách). Bốn chế độ: tự nhận, xoay vòng, theo tải, cố định một người.
- Học từ Pancake nhưng gọn hơn (một thẻ mỗi kênh: chọn chế độ, bảng người kèm trạng thái, số đang giữ và tỷ lệ chia, một khối "Tùy chọn" thu gọn):
  - Tỷ lệ chia 1 đến 10 (xoay vòng xen kẽ; theo tải tính số việc ÷ tỷ lệ).
  - Ưu tiên người trực tuyến (mở KP Chat trong 2,5 phút gần nhất, không tạm nghỉ); không ai trực tuyến thì chia đều.
  - Giới hạn số hội thoại đang mở mỗi người; giờ làm việc riêng của việc chia (ngoài giờ để chưa nhận).
  - Chuyển người khác nếu chưa trả lời sau N phút (chỉ hội thoại tự chia, một lần cho mỗi tin của khách; hội thoại giao tay không bị chuyển).
  - Khách quay lại giao về người cũ.
- Nhân viên có công tắc "Đang nhận khách" ở thanh trên để tạm nghỉ; quản trị đổi hộ được. Chỉ chia cho người có mức Nhắn tin ở kênh, không bao giờ chia cho admin.
- Nút "Chia lại các hội thoại chưa nhận" dùng sau khi đổi cấu hình hoặc khi có người quay lại.
- Chưa làm so với Pancake: xáo trộn thứ tự mỗi vòng, tài khoản phụ (một hội thoại nhiều người), tách riêng tin nhắn và bình luận, chia theo ca, chia theo nhóm/phòng ban (chờ host adapter), giới hạn theo số hội thoại chờ đọc.

## Quyền vào kênh: khác Pancake ở đâu
- Pancake cần cấp quyền admin trên fanpage cho từng nhân viên. KP Chat nối kênh **một lần** bằng token của người có quyền quản trị kênh; nhân viên **không cần quyền gì trên Facebook, Zalo, TikTok**. Họ vào bằng tài khoản KPF và chỉ được vào kênh nào được tích ở Phân quyền theo kênh. Thêm hoặc cho nghỉ nhân viên chỉ làm ở KPF.

## Nối Facebook bằng đăng nhập
Quản trị Page bấm **Đăng nhập Facebook** ở Cài đặt > Kết nối kênh, chọn các Page muốn nối. Nhân viên không cần quyền gì trên Facebook.
- Luồng (đã đối chiếu tài liệu Meta, Graph API v27.0): hộp thoại `facebook.com/v27.0/dialog/oauth` (có `state` dùng một lần, hết hạn 15 phút) → Meta chuyển về `/api/connect/meta/callback?code` → đổi mã lấy token người dùng → đổi sang **token dài hạn** (khoảng 60 ngày; token Page lấy từ đó không hết hạn theo lịch) → `/me/accounts` lấy danh sách Page kèm token Page và tác vụ → hộp chọn Page → tạo kênh (luôn tắt gửi tin), lưu token mã hóa, đăng ký `subscribed_apps` nhận tin. Chọn thêm Instagram liên kết với Page thì tạo kênh Instagram dùng chung token Page. Nối lại Page đã có chỉ cập nhật token.
- Token Page nằm trong phiên chọn (mã hóa, 15 phút, dùng một lần); giao diện không bao giờ nhận được token.
- Page mà người đăng nhập thiếu tác vụ MESSAGING bị khóa chọn và báo rõ.
- Biến môi trường: `META_APP_ID`, `META_APP_SECRET` (đã có), `META_VERIFY_TOKEN` (đã có), tùy chọn `META_LOGIN_CONFIG_ID` (Facebook Login for Business, dùng `config_id` thay cho `scope`).
- Quyền xin (khi không dùng config_id): `pages_show_list, pages_messaging, pages_manage_metadata, pages_read_engagement, business_management, instagram_basic, instagram_manage_messages`. Meta: Standard Access chỉ dùng được với người có vai trò trên app hoặc Page (đủ để thử và để nối Page của chính mình); phục vụ người không có vai trò cần Advanced Access qua App Review và có thể cần xác minh doanh nghiệp.
- CHƯA XÁC MINH: tên trường Page trả về Instagram liên kết (đang dùng `instagram_business_account`, nếu thiếu thì chỉ nối được Messenger); danh sách quyền chính xác cần Advanced Access; điều kiện khiến token Page dài hạn bị vô hiệu; luồng chưa thử với ứng dụng Meta thật (đã test bằng fetch giả: đổi mã, token dài hạn, phân trang, chọn, nối lại, lỗi đăng ký).
- Khi đăng nhập thật cần: ứng dụng Meta đã thêm URI chuyển hướng `.../api/connect/meta/callback`, ở chế độ Live nếu muốn khách ngoài vai trò nhắn được, và địa chỉ công khai HTTPS (`KPCHAT_PUBLIC_URL`).

## Kết nối Meta thật: đã thử ngày 21-22/11/2026
Đã chạy được với app Meta "KP Chat" (chế độ phát triển) và Page thật của chủ app, qua `cloudflared` tạm:
- **Đăng nhập Facebook (Login for Business)**: chạy. Cấu hình `KP Chat Messenger` (mã truy cập người dùng) có 5 quyền: `business_management, pages_manage_metadata, pages_messaging, pages_read_engagement, pages_show_list`. Nối được 4 Page.
- **Webhook Page**: Meta tự xác minh được qua nút "Tự cấu hình webhook"; tin khách nhắn **về** hộp thư; tin trả lời từ KP Chat **tới** Messenger của khách. Chiều gửi chỉ bật cho một Page thử.
- **Tên và ảnh khách**: lấy qua Graph `/{PSID}?fields=name,profile_pic` sau khi ghi tin (`src/core/profile.ts`, chạy trong `after()`), thử lại tối đa mỗi giờ; đã hiện đúng với khách thật. Ảnh Meta có thể hết hạn, chưa tự làm mới.
- **Bài học**: (1) địa chỉ `trycloudflare.com` bị hộp thoại đăng nhập của Meta từ chối ("Miền của URL này không được đưa vào miền của ứng dụng") dù đã khai Miền ứng dụng, Trang web và OAuth URI; (2) Meta cho `http://localhost:PORT/...` làm URI chuyển hướng khi app ở chế độ phát triển, và không nhận `localhost` làm "Miền ứng dụng". Nên đăng nhập quay về `localhost` (`loginBase` trong `src/server.ts`), còn webhook dùng đường hầm; (3) form Cài đặt cơ bản của Meta luôn báo "chưa lưu" khi rời trang dù đã lưu; tải lại để kiểm.
- **Chưa làm**: Instagram (webhook làm tay trong App Dashboard), Meta App Review / Advanced Access, tên miền cố định, máy chủ chạy thường trực, làm mới ảnh khách.

## Trả lời sau 24 giờ: Human Agent (đã tìm hiểu ngày 22/11/2026; đã viết sẵn, tắt mặc định: xem mục "Meta: tiến độ 22/11/2026" bên dưới)
Meta chỉ cho Page trả lời trong 24 giờ kể từ tin cuối của khách. Thẻ **Human Agent** kéo dài lên **7 ngày**; đây là cách Pancake trả lời được hội thoại cũ.
- Nguồn: developers.facebook.com/docs/features-reference/human-agent, .../messenger-platform/send-messages, .../messenger-platform/policy.
- Điều kiện: xin ở App Dashboard > App review > Permissions and features > Human Agent; phải qua **App Review** và **xác minh doanh nghiệp**, có thể phải ký thêm hợp đồng.
- Dùng cho nhân viên thật hỗ trợ vấn đề không xong trong 24 giờ. **Cấm** nội dung quảng cáo, khuyến mãi; **chatbot không được dùng** thẻ này. Dùng sai có thể bị hạn chế Page.
- Khi làm: người đã gửi quá 24 giờ nhưng chưa quá 7 ngày thì mở lại ô soạn kèm dòng nhắc nội dung phải là hỗ trợ; quá 7 ngày vẫn khóa. Bật bằng công tắc cấu hình, mặc định tắt cho tới khi Meta duyệt. Chatbot sau này phải bị chặn gửi ngoài 24 giờ.
- CHƯA XÁC MINH: giá trị chính xác trong Send API (nhớ là `messaging_type: "MESSAGE_TAG"`, `tag: "HUMAN_AGENT"`, cần đối chiếu trang Send API); có dùng được ở chế độ phát triển cho người có vai trò trong app hay chỉ sau duyệt (cách chắc nhất: thử gửi ở Page thử); có áp dụng cho Instagram không; quyền cấp theo app hay theo Page; nội dung hồ sơ App Review chi tiết.
- Chuẩn bị chung cho đợt nộp duyệt: tên miền cố định, chính sách quyền riêng tư, điều khoản dịch vụ, biểu tượng app, danh mục, xác minh doanh nghiệp (La Bàn Corp: chưa biết đã xác minh chưa, xem Business Settings > Security Center).

## Meta: tiến độ 22/11/2026 (Instagram, Human Agent, nộp duyệt, nối lại Page)
**Instagram** (chưa thử với tài khoản thật; hướng dẫn từng bước ở `docs/KET-NOI-META.md` phần 4)
- Rà lại với tài liệu Meta: webhook Instagram làm tay ở App Dashboard (Webhooks > Instagram, trường `messages`), `entry.id` là id tài khoản Instagram chuyên nghiệp, tin do tài khoản gửi có `is_echo`, gửi qua `/{PAGE_ID}/messages` với IGSID, tài khoản phải bật "Cho phép truy cập tin nhắn", ứng dụng phải Đã đăng mới nhận webhook, đăng ký Page `subscribed_apps` với trường `messages`.
- Code: bỏ tin tự gửi (`is_self`), tin không hỗ trợ hiện dòng báo, `ingest.ts` khớp kênh Instagram theo id Instagram hoặc, nếu Meta gửi id Page, theo `meta.pageId`; `metacheck.ts` kiểm từng kênh Instagram (token, Page liên kết, đăng ký nhận tin) và nhắc hai việc không kiểm được bằng API. Test: `tests/metainstagram.test.ts` (9 ca), thêm ca trong `tests/metacheck.test.ts`.
- CHƯA XÁC MINH: tài liệu không nói rõ `entry.id` trên đường Facebook Login là id Instagram hay Page (đã khớp cả hai); giới hạn độ dài tin Instagram qua Page; có dùng được khi ứng dụng chưa Đã đăng cho người có vai trò; menu "Cho phép truy cập tin nhắn" trên bản tiếng Việt.

**Human Agent** (đã viết, TẮT mặc định)
- Công tắc `META_HUMAN_AGENT=1` (`src/core/metahuman.ts`). Tắt thì hành vi như cũ (24 giờ). Bật thì Messenger và Instagram gửi được từ 24 giờ tới 7 ngày: `send.ts` đặt thẻ, adapter gửi `messaging_type: "MESSAGE_TAG"` + `tag: "HUMAN_AGENT"`, ô soạn mở lại kèm dòng nhắc "chỉ nội dung hỗ trợ, không quảng cáo" (`/api/inbox` trả `humanAgent`). Quá 7 ngày vẫn khóa.
- Chatbot không bao giờ dùng: `sendMessage` có cờ `automated` từ chối ngoài 24 giờ, `botEligibility` chỉ biết cửa sổ 24 giờ, test đọc mã nguồn chatbot không được nhắc tới Human Agent. Adapter tự kiểm lại (thẻ khi công tắc tắt, thẻ lạ, quá 7 ngày, thiếu mốc tin khách đều từ chối). Meta từ chối thẻ thì lỗi hiện nguyên văn kèm gợi ý.
- Test: `tests/metahuman.test.ts` (21 ca gồm cả Instagram).
- CHƯA XÁC MINH: dạng JSON (trang Send API không đọc được, trang send-messages chỉ nói "within a 7-day period"); thử được ở chế độ phát triển hay chỉ sau duyệt; cách chắc nhất là gửi một tin thật ở Page thử ngay khi được cấp quyền.

**Nộp duyệt**: `docs/META-NOP-DUYET.md` (hai con đường nộp, danh sách quyền, việc chuẩn bị, nội dung chính sách riêng tư, mô tả và kịch bản quay cho từng quyền, Human Agent, thứ tự làm). Việc cần anh Khai: chốt loại ứng dụng, kiểm tra La Bàn Corp đã xác minh doanh nghiệp chưa, tên miền, trang chính sách.

**Nối lại Page ("có vẻ chưa ổn")**: đã tìm ra và sửa hai lỗi thật bằng test:
1. Page từng **Gỡ kết nối** rồi nối lại tạo kênh mới nhưng kênh cũ (off) cùng mã đứng trước; `ingest` chọn nhầm kênh cũ nên **mọi tin về bị bỏ**. Sửa: `ingest` ưu tiên kênh đang nối; `connectPages` mở lại kênh cũ (giữ lịch sử và phân quyền, gửi tin tắt).
2. Page không hiện trong danh sách mà không biết vì sao. Thêm chẩn đoán (`diagnoseLogin`): hỏi `/me/permissions` và `debug_token` (granular_scopes) để biết quyền nào bị từ chối, Page nào đã chia sẻ nhưng Meta không trả về; hiện ở hộp chọn Page (kèm hướng dẫn Facebook > Cài đặt > Tích hợp doanh nghiệp > KP Chat > Chỉnh sửa) và ghi nhật ký máy chủ dòng `[meta-login]` (không token). Cờ `rerequest` đi theo state để nhật ký ghi lại.
- CHƯA XÁC MINH: `auth_type=rerequest` có hiện lại hộp chọn Page ở Login for Business không (Meta thật mới biết); dạng phản hồi `debug_token` với token Login for Business (code đọc linh hoạt, lỗi thì bỏ qua); Page thuộc Business Portfolio có thể không có trong `/me/accounts` dù đã chia sẻ (chẩn đoán sẽ báo "thiếu").
- Test: `tests/metalogin.test.ts` (5 ca mới), `tests/metainstagram.test.ts` (ca Page nối lại).

## Zalo cá nhân (làm ngày 22/11/2026; đã thử tạo QR thật, chưa thử đăng nhập một số thật)
Nhân viên dùng số Zalo công ty nên KP Chat nối cả Zalo cá nhân bên cạnh Zalo OA. **Không chính thức**: Zalo không có API cho tài khoản cá nhân, dùng thư viện cộng đồng `zca-js` (ghim `2.3.0`, MIT, một người duy trì; đã xem: chỉ gọi máy chủ Zalo, tắt `checkUpdate` vì nó gọi registry.npmjs.org; cài bằng `--ignore-scripts`). Vi phạm điều khoản Zalo, có nguy cơ khoá số.
- **Cách nối**: Cài đặt > Kênh > **Nối Zalo cá nhân**, quét QR bằng Zalo trên điện thoại (như đăng nhập Zalo Web). Mỗi số là một kênh `zalo_personal-xxxx`, mới nối luôn **tắt gửi tin**. Phiên (cookie, imei, user agent) lưu mã hoá AES-256-GCM (`zalo-p:<kênh>`), lên giao diện không bao giờ có phiên.
- **Mã nguồn**: `src/core/zalopersonal.ts` (quản lý phiên, QR, nghe tin, gửi), `src/adapters/zalo-personal.ts`, API `src/app/api/connect/zalo-personal/route.ts`, giao diện trong `ChannelsPane.tsx`. `next.config.mjs` có `serverExternalPackages: ["zca-js"]`. Khi máy chủ bật, `boot()` đăng nhập lại các số đã nối (lần lượt, nghỉ 3 giây giữa các số).
- **Nhận tin**: chỉ chat 1-1; nhóm bị bỏ qua. Nhận cả tin gửi từ điện thoại (`selfListen`) thành tin đi. Tên khách lấy từ tin, thiếu thì gọi `getUserInfo`. Tin ảnh và tệp vào hộp thư; loại khác hiện dòng "[Tin nhắn ... chưa hiển thị được]".
- **Gửi tin**: chỉ chữ (chưa gửi ảnh, tệp). Hàng rào chống khoá: gửi tuần tự theo từng số, cách nhau 2,5 đến 5 giây, tối đa 300 tin mỗi ngày mỗi số (đổi bằng `ZALO_PERSONAL_DAILY_CAP`), không có gửi hàng loạt, chatbot sau này không được gửi qua kênh này.
- **Mất kết nối**: số bị đăng nhập nơi khác (mã đóng 3000, 3003, ví dụ mở Zalo Web) thì dừng và báo, **không** tự giành lại phiên (tránh chen nhau gây nghi ngờ); rớt mạng thì nối lại tối đa 3 lần (30 giây, 2 phút, 10 phút) rồi chờ quét lại QR.
- **Chưa làm**: nhóm chat, gửi ảnh và tệp, tải lịch sử tin cũ (thư viện có `requestOldMessages`), chạy ổn định khi lên máy chủ thật (cần tiến trình nền riêng, một phiên nghe cho mỗi số, không dùng serverless), xử lý Zalo đổi giao thức.
- **CHƯA XÁC MINH với số thật**: đăng nhập QR đến cùng, định dạng tin ảnh và tệp thật, hành vi khi điện thoại ngắt mạng, ngưỡng Zalo bắt đầu nghi ngờ.

### Zalo: tiến độ tiếp (phiên Zalo, 22/11/2026). Chỉ kiểm bằng bản giả của zca-js và fetch giả, chưa thử số thật hay OA thật
**Zalo cá nhân: gửi ảnh**
- Gửi được ảnh jpg/png từ khung chat (nút chọn ảnh và mẫu có ảnh dùng được cho kênh này). Adapter chỉ đọc ảnh **đã tải lên KP Chat** (lấy mã từ địa chỉ `/api/media/<mã>`, đọc byte trong `data/media`, không tải địa chỉ ngoài), đo kích thước từ phần đầu tệp (`src/core/zalomedia.ts`), gửi cho zca-js dạng byte.
- Một ảnh kèm chữ thành một tin ảnh có chú thích; nhiều ảnh (tối đa 5): chữ đi trước, rồi cả bộ ảnh một lượt. Hạn mức ngày tính theo **số tin tạo ra** (mỗi ảnh một tin), kiểm trước, không gửi nửa chừng vì hết hạn mức; giãn cách 2,5 đến 5 giây giữa các lần gọi như cũ. Lỗi giữa chừng báo rõ "phần chữ đã gửi, ảnh chưa gửi được".
- **Tệp (pdf, docx...)**: zca-js gửi được, nhưng KP Chat chưa có đường **tải tệp lên** (`media.ts`, route tải lên, khung chat chỉ nhận jpg/png) là các file dùng chung nên chưa sửa. Adapter hiện từ chối tệp với lời báo rõ. Làm khi có yêu cầu: mở rộng tải lên, rồi thêm một nhánh trong `zalo-personal.ts`.
**Zalo cá nhân: tải tin cũ**
- `src/core/zalohistory.ts`, dùng `listener.requestOldMessages` của zca-js và sự kiện `old_messages`; giao diện: Cài đặt > Kênh > chi tiết số Zalo > bước 4 (dùng lại khối "Tải tin cũ" của Messenger, tiến độ hỏi qua `/api/channels/<id>/history`, route này nay chia theo loại kênh).
- Đúng kiểu `history.ts`: tin đánh dấu `history: true`, hội thoại cũ vào trạng thái "đã xong", không chia khách, không tính SLA, không báo chưa đọc, chạy lại không trùng. Lùi từng lô, lấy mã tin cũ nhất của lô làm mốc cho lô sau, nghỉ 3 giây giữa các lô (không dồn dập), dừng khi hết tin, khi lô không cũ hơn lô trước (chống lặp vô hạn), khi chạm mốc số ngày, hoặc khi bấm Dừng; chờ tối đa 20 giây một lô, không phản hồi thì báo lỗi. Sau khi tải, lấy tên tối đa 50 khách chưa có tên.
- **CHƯA XÁC MINH với số thật**: Zalo trả bao nhiêu tin một lô và lùi được bao xa; `lastMsgId` có đúng là mã tin (`msgId`) như đang dùng không (nếu sai thì lô thứ hai lặp, bộ chống lặp sẽ dừng và chỉ có lô đầu); cần điện thoại online hay không. Thử đầu tiên nên chọn "30 ngày" trên một số công ty.
**Zalo cá nhân: nhóm chat (quyết định: ĐƯA VÀO, theo từng nhóm, MẶC ĐỊNH TẮT)**
- Lý do đưa vào: nhân viên bán hàng hay có "nhóm khách" trên Zalo. Lý do mặc định tắt: số công ty vẫn có thể ở nhóm riêng tư, tin nhóm nhiều và ồn, mọi nhân viên có quyền kênh sẽ thấy.
- Admin vào chi tiết số Zalo > bước 5 > "Xem danh sách nhóm" (lấy từ Zalo), tích nhóm cần nhận rồi Lưu; áp dụng ngay, không cần nối lại. API `/api/connect/zalo-personal/groups` (GET, PUT, chỉ admin). Danh sách bật lưu ở `channel.meta.groups` (mã nhóm cách nhau dấu phẩy, tối đa 200), không đổi kiểu dữ liệu chung.
- Một nhóm là một hội thoại, mã khách ngoài `g:<mã nhóm>` (khác mã người dùng), tên và ảnh nhóm lấy qua `getGroupInfo` (cơ chế `fetchProfile`). Tin của thành viên ghi `Tên người: nội dung`; tin của số mình không thêm tên. Gửi vào nhóm dùng loại luồng nhóm. Tải tin cũ cũng lấy tin của các nhóm đã bật.
- **Hạn chế đã biết**: SLA, thống kê và chia khách coi hội thoại nhóm như khách thường nên nhóm sôi nổi sẽ làm số "chờ trả lời" và "bỏ lỡ" lệch; chatbot soạn nháp cho cả tin nhóm nếu kênh bật bot. Chưa có cờ "bỏ qua nhóm" trong SLA/bot (phải sửa file dùng chung). Nên bật ít nhóm khách thật sự cần.
**Zalo OA: rà adapter và lấy tên/ảnh khách**
- Đã thêm `fetchProfile` cho adapter OA: `GET https://openapi.zalo.me/v3.0/oa/user/detail?data={"user_id":"..."}`, header `access_token`; tên = `display_name` (hoặc `user_alias`), ảnh = `avatars["240"]` hoặc `avatar`; token sai thì làm mới một lần rồi thử lại; lỗi thì không đổi gì và lõi thử lại tối đa mỗi giờ (webhook đã gọi sẵn cơ chế này sau khi ghi tin). Chỉ lấy được người đã quan tâm hoặc tương tác với OA (FAQ Zalo: lỗi -201 khi chưa follow).
- **Giới hạn của lần rà**: các trang tài liệu developers.zalo.me dựng bằng JavaScript nên công cụ đọc trang không đọc được nội dung; tên trường và URL của user/detail, URL cấp quyền, cách tạo `code_challenge` (SHA-256, base64url, kèm `code_challenge_method=S256`) được đối chiếu với **SDK cộng đồng** (`@warriorteam/redai-zalo-sdk`, không chính thức), khớp với phần adapter đang làm (token làm mới ở `oauth.zaloapp.com/v4/oa/access_token`, header `secret_key`). SDK đó đổi mã cấp quyền lần đầu ở `openapi.zalo.me/v2.0/oa/oauth/access_token` (cũ); adapter vẫn dùng v4 theo trang tài liệu ghi ở mục Zalo OA phía trên. Hai điểm cần thử thật: (1) đổi mã lần đầu ở v4 có nhận `code_verifier` không; (2) URL cấp quyền của KP Chat chưa gửi `code_challenge_method=S256` (SDK có gửi); nếu Zalo từ chối thì thêm vào `zaloAuthUrl` trong `connect.ts` (file dùng chung nên chưa sửa), hoặc dùng URL do trang Zalo for Developers sinh.
- Chưa làm: sự kiện `oa_send_*` (đồng bộ tin gửi từ app Zalo OA, chưa kiểm tên sự kiện và việc `msg_id` có khớp mã trả về khi gửi, sợ nhân đôi tin), gửi tệp, kiểm hạn mức ngoài 48 giờ.
- **Còn thiếu để nối Zalo OA thật** (cần anh Khai và tên miền cố định, KHÔNG làm được ở phiên này): (1) tên miền cố định HTTPS (dự kiến kpchat.laban.asia) trỏ về máy chủ KP Chat, đặt `KPCHAT_PUBLIC_URL`; (2) ở Zalo for Developers: xác thực tên miền (meta tag hoặc file HTML), điền URL webhook `<tên miền>/api/webhook/zalo_oa` và gắn sự kiện tin nhắn người dùng gửi, khai URL chuyển hướng `<tên miền>/api/connect/zalo/callback`, điền SĐT và email liên hệ, kích hoạt ứng dụng (App ID có trong `.env.local`); (3) `ZALO_APP_SECRET` (khóa bí mật ứng dụng) và `KPCHAT_SECRET_KEY` phải có trong `.env.local` (CHƯA XÁC MINH: chữ ký webhook theo tài liệu dùng "OA secret key"; adapter đang dùng `ZALO_APP_SECRET` cho cả chữ ký và đổi token. Nếu cổng Zalo for Developers cho hai khóa khác nhau thì phải thêm biến riêng cho chữ ký, thấy rõ ngay khi thử vì webhook sẽ bị trả 401 "sai chữ ký"); (4) quản trị OA bấm cấp quyền ở Cài đặt > Kênh > Zalo OA; (5) bật gửi tin sau khi nhắn thử.

## Thanh công cụ kênh gọn lại (22/11/2026)
Cài đặt > Kênh trước có 6 nút ngang hàng; nay còn hai menu:
- **Thêm kênh** (nút cam): Page Facebook và Instagram (đăng nhập Facebook; muốn chọn lại quyền chia sẻ Page thì dùng nút "Chọn lại quyền Facebook" trong cửa sổ chọn Page, đăng nhập với `auth_type=rerequest`) · Zalo cá nhân (quét QR, nối nhiều số) · Zalo OA · TikTok. Không còn nhập tay Messenger ở menu (đăng nhập Facebook đã lấy Page, token, đăng ký nhận tin); dán token thủ công chỉ còn trong Chi tiết Page > Nâng cao. Cửa sổ "Thêm kênh" chỉ còn cho Zalo OA và TikTok (đặt tên).
- Không còn menu "Công cụ" ở thanh công cụ (kỹ thuật, ít dùng, danh sách tự cập nhật). "Kiểm tra cài đặt Meta" và "Xem địa chỉ webhook" nằm trong Chi tiết Page > Nâng cao.
- Danh sách kênh mỗi dòng có "Nhân viên: ..." (ai được vào kênh); Page có token bị thu hồi hoặc hết hạn hiện "Hết hạn" và nút "Kết nối lại" (kiểm token qua `GET /api/channels/health`, `src/core/metahealth.ts`; kèm kiểm Page đã đăng ký nhận tin).
- Chọn Page sau khi đăng nhập Facebook: có tìm kiếm, lọc (chưa nối, đã nối, thiếu quyền), chọn các Page đang hiện, đếm Facebook trả về bao nhiêu Page.
- Chi tiết Page Facebook: bốn bước (kết nối bằng Facebook, đăng ký nhận tin, bật gửi, tải tin cũ); dán token thủ công chuyển vào mục "Nâng cao".
- Zalo nhiều số: mỗi số một kênh, **đổi tên** được (`PATCH /api/channels { id, name }`) và gán nhân viên dùng số (Không vào, Chỉ xem, Nhắn tin) ngay trong chi tiết kênh. Quản trị luôn thấy mọi số để theo dõi.
- CHƯA XÁC MINH: `auth_type=rerequest` có làm Facebook Login for Business hiện lại hộp chia sẻ Page hay không (tài liệu Meta nói cho quyền bị từ chối; với Page mới có thể phải vào Facebook > Cài đặt > Tích hợp doanh nghiệp > KP Chat > Chỉnh sửa).

- Cài đặt > Kênh: ô tìm, lọc loại kênh và nút Thêm kênh nằm ngay trên hàng tiêu đề "Kết nối kênh" (cổng React vào `#kc-slot-conn` do `SettingsPane` dựng), bỏ dòng chữ phụ và thanh lọc riêng.

## TikTok: điều kiện truy cập (tra ngày 22/11/2026, tài liệu chính thức business-api.tiktok.com; chưa làm)
Hai sản phẩm khác nhau, **không dùng chung**: (1) Business Messaging API: tin nhắn trực tiếp (DM) của tài khoản TikTok; (2) TikTok Shop Messaging: chat người mua và người bán của gian hàng, API riêng ở TikTok Shop Partner Center. Adapter hiện có (`src/adapters/tiktok.ts`) viết cho loại (1).
- **Khu vực**: không dùng được cho tài khoản đăng ký ở EEA, Thụy Sĩ, Anh; Mỹ cần thêm đánh giá bảo mật dữ liệu Mỹ. Còn lại ("Rest of World", gồm Việt Nam) dùng được sau khi qua **Data security & privacy review**. Khu vực tính theo nơi đăng ký tài khoản TikTok.
- **Điều kiện truy cập**: (a) có ứng dụng nhà phát triển đã duyệt và App ID (xin kèm quyền "Ad Account Management", "CTX Events Management", "Measurement"); (b) nộp biểu mẫu Data security & privacy review; TikTok bắt đầu xử lý trong 10 ngày làm việc và gửi email bảng câu hỏi thẩm định bên thứ ba (DSPR DDQ); khuyến nghị đính kèm chứng chỉ ISO 27001, báo cáo SOC 2 hoặc kết quả quét lỗ hổng, kiểm thử xâm nhập; do TikTok duyệt tay, **không theo dõi được tiến độ**.
- **Tài khoản TikTok**: chỉ tài khoản có Advanced Access hoặc **Verified Business Account (VBA)**; tài khoản thường không dùng được.
- **Quy tắc nhắn**: nhận tin qua webhook, mỗi cuộc trò chuyện có `conversation_id`; trả lời bằng `/business/message/send/` (chữ, ảnh, thẻ mẫu, bài đăng TikTok); **cấm nhắn trước** cho người chưa nhắn mình; với người không theo dõi lẫn nhau có giới hạn số tin; ảnh chỉ khi hai bên ở nước hỗ trợ ảnh trong DM; `conversation/list` trả tối đa 100 cuộc, `content/list` 20 tin gần nhất.
- Trước khi làm: chốt dùng DM TikTok hay TikTok Shop, tài khoản có phải VBA không, công ty có điền được bảng câu hỏi bảo mật không. Trong lúc chờ duyệt, TikTok vẫn đọc qua Pancake của KP Chat 1.1.

## Chatbot (làm ngày 22/11/2026: soạn nháp cho nhân viên duyệt, và chế độ Tự trả lời do quản trị bật)
Theo khuyến nghị trong `docs/CHATBOT-NGHIEN-CUU.md`. Bản đầu chỉ soạn nháp; cùng ngày anh Khai yêu cầu thêm chế độ **bot tự gửi khi quản trị bật** (mục "Cập nhật" ở cuối phần này). Mặc định mọi kênh tắt. Chưa thử với mô hình Claude thật (chưa có `ANTHROPIC_API_KEY` trong `.env.local`); đã thử toàn bộ luồng bằng bản giả của mô hình.

**Quyết định**
- Ba chế độ cho từng kênh (Cài đặt > Chatbot): **Tắt** (mặc định) · **Soạn âm thầm** (shadow: bot soạn cho mọi tin khách, nhân viên không thấy, dùng để đo) · **Soạn nháp cho nhân viên** (nháp hiện trong khung chat). Chế độ thứ tư **Tự trả lời** thêm sau (xem mục Cập nhật).
- **Lõi soạn không có đường gửi**: `chatbot.ts` không import `send.ts` hay `service.ts` (test đọc mã nguồn để kiểm). Nháp chỉ thành tin gửi khi nhân viên bấm **Dùng** ở `botreview.ts`, và khi đó đi qua `sendReply` bằng quyền của chính nhân viên (kiểm quyền kênh, công tắc gửi, cửa sổ trả lời, tin mang tên nhân viên, không phải tên bot). **Sửa** đưa nội dung vào ô soạn (nhân viên tự gửi), **Bỏ** hủy nháp. Hai người cùng bấm Dùng chỉ gửi một lần; gửi lỗi thì nháp quay về chờ duyệt.
- **Zalo cá nhân**: bot chỉ soạn nháp (có test), tuyệt đối không gửi. **Ngoài cửa sổ trả lời** (Messenger 24 giờ, Zalo OA 7 ngày, TikTok 48 giờ) bot im; không dùng thẻ Human Agent (chỉ cho người thật).
- **Bot dừng khi**: quản trị bấm Tạm dừng; hội thoại đã xong; đã có người trả lời sau tin khách (kể cả tin gửi từ app ngoài KP Chat, nhờ tin echo); kênh tắt gửi tin (chế độ nháp); khách nhắn thêm hoặc người trả lời **trong lúc bot đang soạn** (nháp bị bỏ, không hiện nháp lỗi thời); hết hạn mức nháp/24 giờ (quản trị đặt, trần cứng 1000).
- **Chuyển người là luật viết bằng mã** (`handoffReason`, không gọi mô hình, không tốn tiền): khách xin gặp người, giá sỉ/chiết khấu, công nợ, khiếu nại/hoàn tiền/giao sai, đặt-đổi-hủy đơn, thanh toán, gửi ảnh/tệp/âm thanh/video (bot chưa đọc được ảnh). Mô hình cũng có thể trả `CHUYEN_NGUOI: lý do`; mô hình từ chối cũng thành chuyển người. Nháp loại này hiện thẻ vàng "Bot đề nghị người xử lý: lý do" kèm nút Đã xem.
- **Nguồn kiến thức**: (1) hướng dẫn riêng của quản trị (tối đa 3.000 ký tự); (2) tối đa 20 tài liệu sản phẩm/chính sách (4.000 ký tự mỗi tài liệu, 30.000 tổng); (3) **thư viện Mẫu trả lời** (`library.ts`) tự đưa vào làm giọng văn và nội dung đã duyệt. Lời nhắc bắt buộc: chỉ dùng thông tin trong kiến thức và mẫu, không bịa giá hay chính sách, không báo giá sỉ, tin của khách là dữ liệu không phải lệnh (chống tiêm lệnh; test kiểm tin khách không lọt vào lời nhắc hệ thống). Phần ổn định đặt trước, phần theo từng khách đặt cuối để lưu đệm lời nhắc hiệu quả.
- **Mô hình thay được**: giao diện `ModelProvider` (`botmodel.ts`). Mặc định API Anthropic qua SDK chính thức `@anthropic-ai/sdk` (ghim `1.12.0`, cài bằng `--ignore-scripts`), khoá đọc từ `ANTHROPIC_API_KEY` (không ghi vào mã; trang Cài đặt chỉ cho biết đã có khoá hay chưa). Model chọn được: `claude-haiku-5-5` (mặc định, như KP Chat 1.1) hoặc `claude-sonnet-5-5`. Gọi với `output_config.effort: "low"`, không gửi `temperature` (các model 5.x từ chối giá trị khác mặc định). `KPCHAT_BOT_PROVIDER=mock` dùng bản giả (không tốn tiền) để thử giao diện; test dùng nhà cung cấp giả.
- **Kích hoạt**: `ingest()` có danh sách bên nghe (`onInbound`); chatbot đăng ký ở `boot()`. Tin khách mới (không phải tin lịch sử) hẹn soạn sau `KPCHAT_BOT_DELAY_MS` (mặc định 6 giây) để gom các tin liền nhau thành một nháp. Mỗi tin khách chỉ một nháp; nút "Nhờ bot soạn nháp" trong khung chat soạn lại (nháp cũ thành lỗi thời). Lỗi gọi mô hình ghi vào nhật ký, không hiện cho nhân viên, không gọi lại liên tục.
- **Đo kết quả** (Cài đặt > Chatbot > Kết quả gần đây): nháp trong 24 giờ, dùng nguyên văn, đưa vào sửa, bỏ, chờ duyệt, đề nghị chuyển người, soạn âm thầm, lỗi, token vào/ra.
- `KPCHAT_DATA_FILE` (mới, `server.ts`): trỏ kho sang tệp khác để thử với dữ liệu giả mà không đụng `data/chat.json`.

**Mã**: `src/core/chatbot.ts` (cài đặt, luật, lời nhắc, soạn nháp, thống kê), `botmodel.ts` (nhà cung cấp mô hình), `botreview.ts` (Dùng/Sửa/Bỏ), API `/api/bot`, `/api/bot/channel`, `/api/inbox/[id]/draft`, giao diện `BotPanel.tsx` (Cài đặt) và thẻ nháp trong `ChatPane.tsx`, test `tests/chatbot.test.ts` (25 ca). Sửa file dùng chung ở mức nhỏ: `types.ts` (`Channel.bot`), `store.ts` (`DB.bot`), `ingest.ts` (bên nghe tin mới), `server.ts` (`initChatbot`, `KPCHAT_DATA_FILE`), `SettingsPane.tsx`, `ChatPane.tsx`, `chat.css`.

**Đã kiểm (bản soạn nháp)**: `npx tsc --noEmit` sạch; test chatbot 25/25; chạy bản sao riêng với dữ liệu giả + mô hình giả: tin vào qua webhook sinh nháp, nháp hiện trong khung chat, Dùng gửi đúng một tin mang tên người duyệt, "giá sỉ" ra thẻ chuyển người không gọi mô hình, trang Cài đặt lưu và tải lại đúng.
**CHƯA kiểm / chưa làm**: gọi Claude thật (chất lượng nháp, chi phí thật, tên tham số `output_config` với bản SDK này chỉ được kiểm bằng kiểu, chưa bằng lời gọi); bố cục điện thoại của thẻ nháp; so nháp âm thầm với câu nhân viên thật (cần công cụ so sánh); bộ 30-50 hội thoại mẫu ẩn danh để chạy lại khi đổi lời nhắc; đọc ảnh khách gửi; công cụ tra giá/tồn kho (`tim_san_pham` của 1.1) và `ghi_lead`; ghi chú tự tạo khi chuyển người; hạn mức theo hội thoại; luật "hỏi lại cùng ý sau 4 lượt"; tự giới thiệu là trợ lý tự động (cần khi sau này có chế độ tự trả lời); tra chính sách chính thức của Meta/Zalo/TikTok về bot trước khi nghĩ tới tự trả lời.
**Lưu ý**: `npm test` hiện có 9 ca Zalo cá nhân (`tests/zalopersonal.test.ts`) hỏng, **hỏng cả ở bản đã commit trước khi thêm chatbot** (kiểm bằng bản sao của HEAD), không liên quan chatbot; cần phiên khác xem.

### Cập nhật: chế độ Tự trả lời và tab Chatbot riêng (22/11/2026, theo yêu cầu của anh Khai)
Anh Khai chốt: **bot được soạn rồi gửi luôn khi quản trị bật**, giữ nguyên các nguyên tắc dừng; Chatbot tách khỏi Cài đặt thành **tab riêng đứng trước Cài đặt** (chỉ quản trị thấy; trước đó là một nhóm trong Cài đặt).
- Chế độ thứ tư cho từng kênh: **Tự trả lời** (`BotMode = "auto"`). Chỉ quản trị bật, có hộp xác nhận trước khi bật. Đi qua `src/core/botauto.ts`, **chỗ duy nhất bot tự gửi**; `chatbot.ts` vẫn không có đường gửi (test kiểm). Gửi bằng `sendMessage` nên vẫn bị chặn bởi công tắc gửi tin, cửa sổ trả lời và hạn mức số tin của kênh (TikTok 10 tin/48 giờ).
- **Luật dừng của Tự trả lời** (đều có test): quản trị Tạm dừng; kênh tắt gửi tin; quá cửa sổ trả lời; đã có người trả lời sau tin khách (gồm tin gửi từ app ngoài); **nhân viên đã nhận hội thoại** (hội thoại do hệ thống tự chia mà chưa ai làm thì bot vẫn trả lời); **người vừa trả lời trong 1 giờ**; bot đã gửi đủ **8 tin/24 giờ** cho một hội thoại (chống vòng lặp với bot khác); khách nhắn thêm hoặc có người trả lời **lúc bot đang soạn**; lỗi hoặc từ chối của mô hình.
- **Zalo cá nhân: bot không bao giờ tự gửi**, vì là cách nối không chính thức dễ bị khoá số. Cài đặt từ chối chế độ này cho Zalo cá nhân, và `autoGuard` chặn thêm một lớp nữa kể cả khi kho bị ghi sai (có test). Chỉ Zalo cá nhân vẫn soạn nháp cho nhân viên. Nếu anh muốn đổi, sửa một dòng trong `setChannelBot` và `autoGuard`, nhưng rủi ro khoá số thuộc về anh.
- **Chuyển người khi tự trả lời**: khách xin gặp người, giá sỉ, công nợ, khiếu nại, đặt đơn, gửi ảnh/tệp... thì bot **không gửi gì cho khách**; gắn nhãn **"Bot: cần người"** lên hội thoại và ghi chú nội bộ "Bot chuyển người: lý do". Chưa có thông báo đẩy cho nhân viên, chưa nhắn khách "đã chuyển cho nhân viên".
- **Tự giới thiệu là trợ lý tự động**: tin đầu tiên bot tự gửi trong một hội thoại thêm câu giới thiệu (sửa hoặc xóa được ở tab Chatbot; mặc định: "Em là trợ lý tự động của shop. Khi cần, mình nhắn "gặp nhân viên" để được người hỗ trợ ạ."). Theo thông lệ nền tảng; chưa tra được quy định chính thức của Meta, Zalo, TikTok.
- Lời nhắc ở chế độ này nói rõ tin được gửi thẳng, không có người duyệt, không chắc thì chuyển người. Tin của bot lưu với `bot: true`, hiện nhãn "Bot" trong khung chat, **không tính là người trả lời trong SLA** (đo thời gian người thật phản hồi; sửa nhỏ `sla.ts`).
- Thống kê ở tab Chatbot có thêm "Bot tự gửi".
- Mã mới: `botauto.ts` (`runBot`, `autoGuard`, `scheduleBot`, `initChatbot` chuyển từ `chatbot.ts` sang đây), `KpChat.tsx` (tab), 34 ca test chatbot. **Đã kiểm** bằng bản sao dữ liệu giả + mô hình giả: tin vào webhook thì bot gửi trả lời kèm câu giới thiệu (nhãn "Bot"), "gặp nhân viên" thì chỉ gắn nhãn và ghi chú, tab Chatbot hiện trước Cài đặt. **CHƯA kiểm**: gửi thật qua Messenger/Zalo OA/TikTok với mô hình thật; chất lượng và chi phí khi bot tự gửi (nên chạy "Soạn âm thầm" vài ngày trước, rồi bật Tự trả lời ở một kênh thử); danh sách tin của hội thoại hiện "Bạn:" cho tin của bot (chưa sửa).
- **Nguyên tắc tư vấn bán hàng** (anh Khai gửi, đã đưa vào lời nhắc của bot ở cả hai chế độ): hiểu mục tiêu của khách, hỏi mỗi lần một câu, gợi ý 1 đến 3 lựa chọn kèm lý do, mỗi tin một ý, mời bước tiếp theo cụ thể khi khách muốn mua, không ép mua và không tạo khan hiếm giả, thông tin chỉ lấy từ kiến thức, chuyển người khi khiếu nại, thanh toán, ngoại lệ, chất lượng và an toàn thực phẩm. Bot tư vấn đến lúc khách muốn đặt rồi chuyển người (chốt và xác nhận đơn do nhân viên làm). **Chưa làm**: gửi kèm tóm tắt trao đổi khi chuyển người (hiện nhân viên xem lịch sử chat và ghi chú lý do), chăm sóc sau mua và nhắc mua lại (cần dữ liệu đơn hàng), theo dõi lý do khách bỏ đơn và tỷ lệ chốt. Chưa kiểm chất lượng tư vấn bằng Claude thật.

### Cập nhật: tạo chatbot theo loại, gắn kênh, quy tắc riêng (22/11/2026, theo yêu cầu của anh Khai)
Tab Chatbot **không còn liệt kê sẵn các kênh**: trang trống cho đến khi tạo, bấm **+ Thêm chatbot** để tạo (cửa sổ tạo; sửa, tạm tắt, xóa ở từng thẻ).
- **Hai loại**: **Tư vấn khách mới** và **Chăm sóc khách cũ**. Mỗi loại có lời nhắc riêng (tư vấn: hiểu nhu cầu, gợi ý 1-3 lựa chọn, mời đặt; chăm sóc: hỏi thăm, hỗ trợ sau mua, không xem được đơn hàng nên hỏi tình trạng đơn thì chuyển người, chỉ nhắc mua lại khi phù hợp).
- **Chatbot nào trả lời là do khách**: hội thoại có tin đầu trong **7 ngày gần đây** là khách mới, cũ hơn là khách cũ quay lại (`NEW_CUSTOMER_DAYS` trong `chatbot.ts`; mốc này em tự chọn, chưa hỏi anh). Kênh có thể có cả hai loại; **một kênh chỉ có một chatbot mỗi loại** (tạo trùng bị từ chối). Không có chatbot đúng loại thì bot im.
- **Khi thêm**: chọn tên, loại, **một hoặc nhiều kênh**, chế độ (Soạn nháp / Soạn âm thầm / Tự trả lời / Tạm tắt), **giọng điệu** (bốn gợi ý hoặc tự viết), **nguồn dữ liệu** (chọn tài liệu nào trong kho kiến thức được dùng, bật hoặc tắt thư viện Mẫu trả lời), quy tắc riêng thêm, mô hình, câu tự giới thiệu (khi tự trả lời). Kho kiến thức, nút tắt khẩn và hạn mức nháp/ngày là **cài đặt chung** (mục thu gọn cuối trang).
- Zalo cá nhân: chatbot có kênh này chỉ chọn được Soạn nháp hoặc Soạn âm thầm, không Tự trả lời (kiểm ở lưu và ở lúc gửi).
- Dữ liệu: `db.bot.bots` (danh sách chatbot); cấu hình bot **không còn nằm trong kênh** (`Channel.bot` đã bỏ). Nháp có `botId`; thống kê theo từng chatbot. API: `/api/bot` (xem, cài đặt chung), `/api/bot/bots` (POST tạo hoặc sửa, DELETE xóa). Cấu hình cũ theo kênh (bản đầu trong ngày) không được chuyển: chưa có dữ liệu thật dùng nó.
- Test: 36 ca chatbot (thêm tạo, sửa, xóa, trùng kênh, chọn chatbot theo loại khách). Sửa một dòng trong `tests/metahuman.test.ts` của phiên Meta cho khớp cấu trúc mới.
- **CHƯA kiểm**: chất lượng lời nhắc chăm sóc khách cũ với Claude thật; mốc 7 ngày có hợp với thực tế bán hàng của anh không; chăm sóc chủ động (bot tự nhắn hỏi thăm sau khi giao hàng) **chưa làm**, vì bot chỉ trả lời khi khách nhắn tới, và nhắn chủ động ngoài cửa sổ trả lời bị cấm.

### Cập nhật: nhập khóa API Anthropic trong Cài đặt (22/11/2026, theo yêu cầu của anh Khai)
Cài đặt > nhóm **Chatbot > Khóa AI (Anthropic)**: quản trị dán khóa `sk-ant-...` rồi bấm Lưu khóa (Đổi khóa, Xóa khóa).
- Khóa được **kiểm với Anthropic** (một lời gọi liệt kê model, không tốn token) trước khi lưu: sai khóa (401, 403) thì từ chối; không nối được tới Anthropic thì vẫn lưu và báo "chưa kiểm được".
- **Lưu mã hóa** AES-256-GCM trong `db.secrets["bot:anthropic"]` (cùng khóa `KPCHAT_SECRET_KEY` như token kênh), không lộ dạng rõ trong kho (có test). Giao diện và API **không bao giờ trả khóa về**, chỉ cho biết nguồn (nhập ở Cài đặt hoặc biến môi trường) và 4 ký tự cuối. Khóa chỉ do người dùng tự gõ vào trang; em không đọc, không in.
- **Ưu tiên**: khóa nhập ở Cài đặt > biến môi trường `ANTHROPIC_API_KEY` (vẫn dùng được làm dự phòng). Xóa khóa đã lưu thì quay về biến môi trường nếu còn. Đổi `KPCHAT_SECRET_KEY` sau khi lưu thì khóa không giải mã được và coi như chưa có: nhập lại.
- Mã: `chatbot.ts` (`saveAnthropicKey`, `syncBotKey`), `botmodel.ts` (`verifyKey`, `setStoredKey`), `/api/bot/key`, `BotKeyPanel.tsx`. 37 ca test chatbot. **Đã thử**: khóa giả bị Anthropic từ chối 401 đúng, không lưu. **Chưa thử**: lưu và dùng một khóa thật (chưa có khóa thật trong phiên này).
- Lưu ý: bản chạy thử chưa có đăng nhập thật; ai mở được trang với tư cách quản trị là đổi được khóa. Khi mở ra Internet, cổng `KPCHAT_ACCESS_KEY` phải bật.

### Cập nhật: tab Chatbot chia ba mục ngang (22/11/2026, theo yêu cầu của anh Khai)
Tab Chatbot có thanh ngang kiểu Thư viện mẫu (cùng `.kc-libhead` và `.kc-mt`): **Chatbot** (danh sách chatbot, nút + Thêm chatbot, cài đặt chung: tạm dừng và hạn mức), **Kiến thức** (kho tài liệu), **Lịch sử** (kết quả chung, trước đây là mục thu gọn "Kết quả chung", thêm bảng theo từng chatbot). Nhớ mục đang xem. Trang Chatbot cảnh báo khi có chatbot Tự trả lời mà kho kiến thức trống. **Chưa làm**: Lịch sử mới là số liệu cộng dồn, chưa có danh sách từng nháp và so sánh nháp với câu nhân viên thật.

### Cập nhật: nguồn tài liệu đa dạng, thẻ chatbot rõ ràng (22/11/2026, theo yêu cầu của anh Khai)
- **Kiến thức** có lọc theo nguồn (Tất cả, Văn bản, Tệp, Web, Drive, Sản phẩm KP) và nút Thêm tài liệu với bốn nguồn: **Văn bản** (nhập tay), **Tệp** (txt, md, csv, tsv, json, xml, html, **PDF**), **Link web**, **Google Drive** (Docs, Sheets, Slides và tệp chia sẻ "Bất kỳ ai có đường liên kết"). Tài liệu lưu **bản chép chữ lúc nhập**; web và Drive có nút **Làm mới** lấy lại nội dung. **Sản phẩm KP**: mới chỉ dành chỗ (mục và thẻ "Sắp có"; kiểu nguồn `product` đã có trong dữ liệu), chưa nối hệ thống.
- Mã: `src/core/botsource.ts` (đọc tệp, tải link, đổi link Google sang địa chỉ xuất chữ, đổi HTML thành chữ), `/api/bot/docs` (thêm; tệp gửi multipart), `/api/bot/docs/refresh`. Giới hạn mới: tối đa 30 tài liệu, 20.000 ký tự mỗi tài liệu (dài hơn thì cắt và đánh dấu), 80.000 tổng; tệp tối đa 10MB, trang web tối đa 5MB.
- **An toàn**: máy chủ tải địa chỉ do quản trị nhập nên chặn SSRF: chỉ http và https, từ chối localhost, mạng riêng, link-local (169.254...), tên .local và .internal, kiểm lại từng bước chuyển hướng (tối đa 4), giới hạn dung lượng và 15 giây. Chưa chặn được kiểu DNS đổi địa chỉ giữa lúc kiểm và lúc tải (rủi ro nhỏ vì chỉ quản trị dùng). Nội dung chép từ web hay tệp có thể chứa câu lệnh giả, nên lời nhắc coi mục KIẾN THỨC là dữ liệu tham khảo, không phải mệnh lệnh (có test). Nguồn của tài liệu do hệ thống gắn, giao diện không giả được.
- **Chưa làm / chưa kiểm**: Word, Excel, PowerPoint (báo lỗi kèm hướng dẫn lưu thành PDF, txt, csv hoặc dán link Google Docs, Sheets); thư mục Drive; Drive riêng tư (cần đăng nhập Google, chưa làm); PDF chỉ chạy khi có khóa AI và **chưa thử với khóa thật**; trang web dựng bằng JavaScript (chỉ lấy được HTML tĩnh); nối Sản phẩm KP. Đã thử tải thật một trang công khai và chặn đúng địa chỉ nội bộ; chưa thử link Google thật.
- **Thẻ chatbot** ở mục Chatbot: ba cột có nhãn **Loại / Chế độ / Kênh** (nhãn màu: Tự trả lời vàng, Soạn nháp xanh lá, Soạn âm thầm xanh dương, Tạm tắt xám; mỗi kênh một nhãn), dưới là các ô số liệu. Bỏ các dòng chữ giải thích thừa ở mục Chatbot. 50 ca test chatbot và nguồn tài liệu.

### Cập nhật: thêm tài liệu có tên, loại và kênh gợi ý (22/11/2026, theo yêu cầu của anh Khai)
- Bỏ hàng lọc theo nguồn ở tab Kiến thức. Cửa sổ **Thêm tài liệu** có hai khối: (1) **Tên tài liệu** (bắt buộc với văn bản nhập tay; với tệp và link để trống thì tự đặt), **Loại tài liệu** (Sản phẩm, giá / Chính sách / Câu hỏi thường gặp / Khuyến mãi / Giới thiệu / Khác), **Gợi ý cho kênh** (trống = mọi kênh); (2) **Nội dung lấy từ**: nhập văn bản (gõ ngay trong cửa sổ), tệp, link web, Google Drive, Sản phẩm KP (sắp có).
- Mỗi tài liệu sửa được loại và kênh gợi ý ngay trên thẻ. Dữ liệu: `KnowledgeDoc.category` và `channelIds` (kênh không còn tồn tại tự bị bỏ khi lưu).
- Ở form chatbot, mục **Nguồn dữ liệu**: tài liệu hợp với kênh đã chọn (gợi ý cho kênh đó hoặc cho mọi kênh) hiện lên đầu, ghi loại và "gợi ý", kèm nút **Chọn tài liệu gợi ý cho kênh đã chọn**. 227 test qua.

### Cập nhật: ai đang trả lời (bot hay người) và nhập web sạch hơn (22/11/2026, theo yêu cầu của anh Khai)
- **Thanh trạng thái trong khung chat** (dưới tiêu đề hội thoại, theo chatbot áp dụng cho hội thoại): *Bot ... đang trả lời* (vàng, nút **Tiếp quản**); *Bot soạn nháp* (xanh dương); *Bot chuyển người: lý do* (đỏ, nút **Nhận khách**); *X đang phụ trách, bot không trả lời* hoặc *Người vừa trả lời, bot tạm dừng* (xanh lá, nút **Giao lại cho bot**); *X đã dừng bot ở hội thoại này* (xám, nút **Giao lại cho bot**). Chế độ Soạn âm thầm và không có chatbot thì không hiện.
- **Tiếp quản**: bot dừng ở hội thoại này (`Conversation.botCtl.off`), nhân viên nhận khách nếu chưa ai nhận, nháp chờ bị bỏ, gỡ nhãn "Bot: cần người"; bot đang soạn dở cũng không gửi. **Giao lại cho bot**: bỏ phụ trách (người giao lại hoặc quản trị), bot trả lời tiếp từ tin khách kế tiếp, tin người trả lời trước mốc giao lại không làm bot dừng (`botCtl.resumeAt`). Chỉ người có quyền Nhắn tin ở kênh bấm được. Nút "Nhờ bot soạn" vẫn dùng được khi bot đã bị dừng. API `/api/inbox/[id]/bot` ({ action: "takeover" | "handback" }), trạng thái đi cùng `/api/inbox/[id]/draft`.
- **Nhập từ web sạch hơn** (`botsource.ts`, `texttidy.ts`): ưu tiên phần `<main>` hoặc `<article>`, bỏ header, footer, nav, form, nút; lấy **sản phẩm từ dữ liệu cấu trúc JSON-LD** của trang (tên, giá, mô tả) đặt lên đầu; bỏ dòng giao diện (Bỏ qua nội dung, Giỏ hàng, Xem chi tiết, Thêm vào giỏ, Giảm giá!, Đăng nhập, "(5)"...), dòng trống thừa, dòng lặp. Cửa sổ **Sửa tài liệu** có nút **Dọn dòng thừa** để dọn tài liệu đã nhập. Thử với tài liệu nhiễu 17.586 ký tự: dọn còn 8.838, sửa và lưu bình thường. Chưa thử với trang xuxifruit.com mới (anh nhập lại hoặc bấm Làm mới để lấy bản sạch).
- Còn thiếu: khi bot chuyển người ở chế độ Tự trả lời, khách không nhận lời nào; chưa có thông báo đẩy cho nhân viên. 240 test qua.

### Cập nhật: nháp âm thầm cho quản trị xem được (22/11/2026, theo yêu cầu của anh Khai)
Trước đó Soạn âm thầm giấu nháp với mọi người nên không ai xem được. Nay **quản trị thấy nháp âm thầm trong khung chat** của hội thoại: thẻ viền nét đứt "Nháp âm thầm · chỉ quản trị thấy, không gửi cho khách", chỉ đọc (không Dùng, Sửa, Bỏ), còn hiện sau khi người đã trả lời để so với câu thật; nhân viên vẫn không thấy. `shadowDraft` trong `chatbot.ts`, trả qua `/api/inbox/[id]/draft`. Chưa có màn hình đặt nháp âm thầm cạnh câu nhân viên đã trả lời cho cả danh sách (chỉ xem từng hội thoại). 243 test qua.

### Cập nhật: gợi ý cho nhân viên học theo, nút Gợi ý tin nhắn (22/11/2026, theo yêu cầu của anh Khai)
- Chế độ **Soạn âm thầm** đổi thành **Gợi ý tham khảo** (khóa `shadow` giữ nguyên): bot soạn cho mọi tin khách, **mọi người xem được hội thoại đều thấy** thẻ "Gợi ý của bot" (chỉ để tham khảo, bot không gửi gì) kèm nút **Chép vào ô soạn**. Khác **Soạn nháp cho nhân viên**: ở đó có nút Dùng gửi luôn.
- Nút **Gợi ý tin nhắn** cạnh khung soạn, nhân viên bấm lúc nào cũng được, **ở mọi chế độ** (kể cả chatbot đang tạm tắt; nếu kênh có chatbot khác loại khách thì lấy chatbot đó). Người chỉ xem không có nút. Gợi ý (`BotDraft.asked`) hiện cho người xem hội thoại, có nút **Chép vào ô soạn**, **Gợi ý lại**, **Đóng**; không bao giờ tự gửi.
- Gợi ý do nhân viên xin dùng **lời nhắc huấn luyện**: bot là "người hướng dẫn tư vấn bán hàng", bắt buộc thêm một dòng **"Vì sao"** (một câu giải thích cách tư vấn: hỏi nhu cầu trước, gợi ý đúng món, mời bước tiếp theo) để nhân viên học theo. Không chặn theo từ khóa (giá sỉ, khiếu nại...) vì chính nhân viên là người xử lý; vẫn chặn khi khách gửi ảnh hoặc tệp, vẫn theo hạn mức nháp mỗi ngày, tạm dừng toàn hệ thống thì không soạn; vẫn xin được sau khi người đã trả lời.
- Chưa làm: lưu "gợi ý hay" thành mẫu trả lời, thống kê nhân viên dùng gợi ý nhiều hay ít (đang đếm chung trong Lịch sử). 245 test qua; đã thử giao diện với mô hình giả, chưa thử với Claude thật.

## Khung chat nhúng trên web (kênh "Web chat"; làm ngày 22/11/2026, theo yêu cầu của anh Khai)
Mỗi chatbot lấy được **mã nhúng** để dán vào website (nhu cầu từ KP Shop: KPF > KP Shop > Cài đặt > Popup liên hệ > Khung chat trên web, dán `<script ...>` tối đa 6000 ký tự, bật công tắc).
- **Cách hoạt động**: mỗi website là một kênh `kind: "web"` (khóa kênh công khai 32 ký tự hex, nằm trong mã nhúng). Chatbot gắn vào kênh web như mọi kênh khác (loại khách, chế độ, quy tắc, tài liệu). Khách chat trên web thì tin vào hộp thư KP Chat; bot hoặc nhân viên trả lời thì khung chat trên web tự tải về (hỏi định kỳ 3 giây khi mở, 30 giây khi đóng, có số tin chưa đọc). Nhãn trong khung: "Trợ lý tự động" hoặc "Nhân viên"; ghi chú nội bộ không bao giờ lộ.
- **Lấy mã**: tab Chatbot > nút **Mã nhúng** trên thẻ chatbot. Chưa gắn khung chat web thì bấm **Tạo khung chat web và gắn vào chatbot**; (lối tạo khung chat chỉ có ở nút Mã nhúng, đã bỏ link trùng trong form chatbot). Cấu hình khung: tên, tiêu đề, màu, lời chào, vị trí (phải hoặc trái), **website được phép nhúng** (kiểm theo Origin; để trống thì mọi website). Mã: `<script src="<địa chỉ KP Chat>/api/web/widget.js?key=..." async></script>`. Địa chỉ lấy từ `KPCHAT_PUBLIC_URL`, không có thì địa chỉ đang mở (localhost chỉ chạy trên máy anh; giao diện cảnh báo).
- **Theo ghi chú của KP Shop**: script đọc `window.KPS_CHAT = { name, shop, lang }` lúc khởi động: `name` thành tên khung chat (rỗng thì dùng tiêu đề đã cấu hình), `lang` (vi, en, ko, zh, ru) đổi chữ trên khung (ô nhập, nút Gửi, nhãn, lời chào) và **báo cho chatbot trả lời cùng ngôn ngữ** (`Contact.lang`, đưa vào lời nhắc). Hỗ trợ thêm `position` (left, right) và `bottom` (px) trong `KPS_CHAT` để tránh cụm nút Gọi, Zalo, Fanpage của KP Shop (ở góc phải, cao khoảng 150px). Khởi tạo một lần (chống nạp trùng); chạy trong shadow DOM; **chỉ lưu mã phiên của chính nó trong localStorage, không đọc cookie hay dữ liệu của trang**; không nhận tên, số điện thoại hay đơn của khách từ KP Shop.
- **An toàn của API công khai** (`/api/web/widget.js`, `session`, `messages`, `send`; đã mở trong cổng bảo vệ `gate.ts`): mã phiên khách là ngẫu nhiên có chữ ký HMAC (không lưu gì cho đến khi khách nhắn tin đầu), phiên của kênh này không dùng được ở kênh khác, khách chỉ đọc được tin của phiên mình; giới hạn 40 tin mỗi phiên và 120 tin mỗi IP trong 10 phút, 60 lần hỏi tin mới mỗi phút, tin tối đa 1000 ký tự; hiện tin bằng `textContent` (không chạy được mã từ nội dung tin). Giới hạn tần suất lưu trong bộ nhớ (mất khi khởi động lại; chưa đủ cho nhiều máy chủ).
- **Đã thử**: trang web giả nhúng mã (localhost): nút chat hiện, khách nhắn, bot (bản giả mô hình) trả lời, nhân viên trả lời từ hộp thư tới khung sau vài giây, tiêu đề lấy từ `KPS_CHAT.name`, trang tiếng Anh đặt góc trái đúng; 12 test (`tests/webchat.test.ts`) gồm khóa, phiên, CORS, giới hạn, quyền đọc, cú pháp script, cổng bảo vệ. 
- **CHƯA làm hoặc chưa kiểm**: thử trên KP Shop thật (cần địa chỉ công khai cố định, không phải đường hầm tạm; xem `docs/KIEN-TRUC-ONLINE.md`); gắn khách đăng nhập của KP Shop với hội thoại (KP Shop chưa gửi, cần bàn quyền riêng tư); khách gửi ảnh hoặc tệp; báo "đang gõ"; nhiều ngôn ngữ cho lời chào do quản trị đặt; thông báo đẩy cho nhân viên khi khách web nhắn; giới hạn tần suất dùng bộ nhớ chung khi chạy nhiều máy chủ.


## Hàng đợi cần người (làm ngày 22/11/2026, theo yêu cầu của anh Khai: việc số 1 trong thứ tự ưu tiên chatbot)
- Hội thoại vào hàng đợi khi nháp mới nhất của bot là chuyển người (bot đã ghi chuyển người ở chế độ Tự trả lời, hoặc bot đề nghị chuyển người ở chế độ nháp hoặc gợi ý tham khảo) và chưa ai xử lý sau đó. Ra khỏi hàng đợi khi: người đã trả lời, nhân viên tiếp quản, có người bấm Nhận hoặc được giao tay sau lúc bot chuyển (hệ thống tự chia thì chưa tính), hoặc hội thoại đã xong. Khách nhắn thêm vẫn tính là đang chờ. Mã ở `src/core/botqueue.ts` (chỉ đọc, không gửi gì).
- Danh sách Hội thoại: cần người lên đầu (chờ lâu nhất trước), có bộ lọc nhanh "Cần người" kèm số, mỗi dòng ghi lý do bot chuyển và thời gian chờ; quá 15 phút (`NEED_HUMAN_WAIT_MIN`) thì tô đỏ đậm "quá hạn". Tab Hội thoại hiện "N cần người".
- Tổng quan (quản trị): cảnh báo đỏ khi có hội thoại cần người quá 15 phút, cảnh báo vàng khi còn trong hạn.
- Quyền: ai không được xem hội thoại (không có quyền ở kênh, hoặc hội thoại của người khác) thì không thấy nó trong hàng đợi và không tính vào số.
- Chưa làm: thông báo đẩy ra ngoài KP Chat (Zalo, KPF), đổi ngưỡng 15 phút trong Cài đặt, nhắc lại lần hai.
- Đã kiểm: 9 test mới, bản thử với dữ liệu giả (quản trị thấy 2, nhân viên Lan chỉ thấy hội thoại của mình). Chưa kiểm với dữ liệu thật của anh.

## Thước đo chatbot: tab Đánh giá (làm ngày 22/11/2026, theo thứ tự ưu tiên của anh Khai)
- Tab Chatbot có mục **Đánh giá** (sau Kịch bản). Mỗi chatbot có bộ câu mẫu: nạp sẵn 40 câu (8 nhóm × 5, `docs/CHATBOT-BO-CAU-HOI-MAU.md`), sửa được từng câu, thêm bớt tới 60 câu, mỗi câu có đáp án đúng (không bắt buộc) và "bot nên trả lời hay chuyển người".
- **Chạy thử** cho chatbot trả lời cả bộ câu (cùng lời nhắc, tài liệu, luật cứng chuyển người như bot thật). Không tạo hội thoại hay nháp, không gửi tin cho ai; chỉ có gọi mô hình nên tốn tiền theo số câu. Chạy nền, giao diện hiện tiến độ. Một lúc chỉ một lần chạy.
- **Chạy và chấm bằng AI** thêm một lượt mô hình chấm 7 tiêu chí (hỏi nhu cầu, đúng thông tin, gợi ý đúng, xử lý từ chối, bước tiếp, giọng, ngắn gọn; 0 đến 2 điểm hoặc không áp dụng) kèm tiêu chí thứ 8 "chuyển người đúng lúc" do máy kiểm. Người chấm nhận tài liệu của chatbot và đáp án đúng; câu hỏi và câu trả lời chỉ là dữ liệu, lời nhắc hệ thống cố định (có test chống gài lệnh).
- **Đạt** khi: đúng ý (cần chuyển người thì chuyển, cần trả lời thì trả lời), thông tin không bị chấm 0 và đủ 70% điểm (chỉ khi có chấm AI). Anh chấm tay Đạt hoặc Không đạt thì thắng máy. Người chấm lỗi thì câu ghi lỗi, không tính đạt.
- Mỗi lần chạy được lưu (tối đa 30), hiện Đạt x/y, điểm TB, chênh so với lần trước **cùng cách chấm**, kết quả theo nhóm và từng câu. Đây là thước "trước và sau" mỗi khi sửa tài liệu, kịch bản, quy tắc.
- **Lịch sử** thêm ba cột theo chatbot (30 ngày): số cuộc chat bot có soạn, số cuộc khách để lại số điện thoại (từ lúc bot vào cuộc, hoặc hồ sơ khách đã có số) và số cuộc bot chuyển người.
- Chưa làm: tỷ lệ ra đơn và "Chốt" (cần nối KPF), chấm tự động theo lịch hằng tuần, báo cáo "bot sai ở đâu" gom theo chủ đề, ngưỡng đạt chỉnh được, mở Tự trả lời theo nhóm câu khi đạt ngưỡng. Chưa thử với Claude thật (chỉ thử bằng mô hình giả và bản giả của người chấm); chất lượng người chấm cần anh kiểm bằng cách chấm tay vài chục câu và so.

### Điểm gốc đầu tiên của Xuxi Chatbot (22/11/2026, chạy thật có chấm AI, claude-haiku-5-5)
- Bộ "XuXi - 40 câu mẫu" (chưa có đáp án đúng nào): **đạt 33/40 (83%)**, điểm AI trung bình 83%, 0 lỗi gọi mô hình. Tốn 568.044 token vào và 23.578 token ra (khoảng 0,07 đô la, tức hơn một nghìn rưỡi đồng) cho cả bộ có chấm AI, vì mỗi câu gọi mô hình hai lần và tài liệu của Xuxi dài.
- Theo nhóm: Sản phẩm 5/5, Giá 5/5, Giao hàng 5/5, Cửa hàng 5/5, Tình huống khó 4/5, Tồn kho 4/5, Chất lượng 3/5, Đặt hàng và thanh toán 2/5.
- 7 câu không đạt, đều là bot chuyển người hoặc nói "chuyển nhân viên" khi bộ câu đang kỳ vọng trả lời:
  1. Hỏi cách đặt hàng và cách thanh toán (2 câu): luật cứng chuyển người theo từ khóa "đặt, thanh toán" chặn cả câu hỏi chỉ để biết thông tin. Cần quyết: chỉ chặn khi khách muốn làm việc (đặt, đổi, hủy), còn hỏi cách thì trả lời.
  2. Đặt trước cuối tuần, đặt số lượng lớn cho công ty (2 câu): bot chuyển người, có thể là đúng ý (cần nhân viên xác nhận), cần anh quyết kỳ vọng.
  3. Giấy tờ an toàn thực phẩm, chất gây dị ứng (2 câu): tài liệu Xuxi chưa có thông tin nên bot chuyển người. Với dị ứng thì chuyển người là an toàn; nên bổ sung tài liệu và đặt kỳ vọng "chuyển người" cho câu dị ứng.
  4. Đòi giảm 30%: bot trả lời đúng (không hứa giảm, nói nhờ nhân viên) nhưng chỉ nói trong lời văn, **không tạo chuyển người thật** nên sẽ không vào hàng đợi cần người. Cần sửa lời nhắc: khi bot nói sẽ chuyển cho nhân viên thì phải trả CHUYEN_NGUOI.
- Gốc rễ chính: tài liệu của Xuxi hiện chỉ là trang sản phẩm (khoảng 10.000 ký tự), chưa có tài liệu giao hàng, thanh toán, đổi trả, giấy tờ (mẫu A3, A4 trong `docs/CHATBOT-TAI-LIEU-DAO-TAO.md`).
- Điểm AI chưa được kiểm với chấm tay. Chưa đổi gì ở chatbot hay tài liệu sau lần chạy này.
