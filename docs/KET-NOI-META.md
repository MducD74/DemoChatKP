# Nối KP Chat 2.0 với Meta thật: từng bước

Phần 1 là tạo ứng dụng Meta (làm **một lần** cho cả công ty). Phần 2 là cho KP Chat chạy và nối Page. Phần 3 là thử thật. Cuối tài liệu có bảng gỡ lỗi và các việc cần làm trước khi dùng thật cho khách.

**Về độ chính xác:** các bước tạo ứng dụng em ghi theo tài liệu chính thức của Meta đã đọc. Chỗ nào em chưa xác minh được thì ghi **[chưa xác minh]**. Meta đổi tên menu khá thường xuyên: nếu thấy khác, tìm mục có tên gần giống rồi chụp màn hình gửi em, em sẽ sửa tài liệu.

---

## Phần 1. Tạo ứng dụng Meta

### 1.0 Chuẩn bị
- Tài khoản Facebook cá nhân của người sẽ quản lý ứng dụng (nên là tài khoản chính của công ty, vì ứng dụng gắn với người tạo).
- Một email liên hệ.
- Một trang **Chính sách quyền riêng tư** có địa chỉ công khai (một trang chữ trên website công ty là đủ). Cần khi chuyển sang dùng thật.

### 1.1 Tạo ứng dụng
1. Mở **https://developers.facebook.com/apps/creation/** và đăng nhập. Lần đầu Meta sẽ hỏi đăng ký tài khoản nhà phát triển (xác nhận số điện thoại hoặc email).
2. **Bước "App details"**: nhập *tên ứng dụng* (ví dụ `KP Chat`) và *email liên hệ*, bấm **Next**.
3. **Bước "Use cases"** (trường hợp sử dụng): chọn use case liên quan **nhắn tin với khách trên Messenger**. Use case nào không tương thích sẽ bị làm mờ. Một số sản phẩm (Facebook Login for Business, Webhooks) có thể được thêm tự động. Nếu không thấy use case nào hợp thì chọn **Other**. Use case đã chọn **không gỡ được** sau khi tạo, nhưng thêm use case tương thích sau thì được. **[chưa xác minh tên chính xác của use case Messenger; đọc mô tả từng mục trong danh sách]**
4. **Bước "Business"** (danh mục doanh nghiệp): để thử thì chọn **"I don't want to connect a business portfolio yet"**. Nếu công ty đã có Business Portfolio (Meta Business Suite) thì chọn đúng cái đó, vì sau này cần cho xác minh doanh nghiệp.
5. **Bước "Requirements"**: bấm **Next**. **Bước "Overview"**: xem lại, bấm **Go to dashboard**.

### 1.2 Lấy App ID và App Secret, điền thông tin cơ bản
Menu trái **Settings > Basic**:
- **App ID**: copy.
- **App Secret**: bấm **Show** (Meta hỏi lại mật khẩu), copy. **Giữ bí mật**, không dán vào chat, tài liệu hay git. Lộ thì bấm reset ngay ở chính trang này.
- Điền thêm (Meta bắt buộc khi cho người ngoài dùng): **Display Name**, **Contact Email**, **App Domains** (tên miền của KP Chat, ví dụ `kpchat.congty.vn`; khi thử bằng đường hầm thì điền tên miền của đường hầm), **Privacy Policy URL**, **Terms of Service URL**, **App Icon**, **Category**, **App Purpose**.

### 1.3 Cho phép đăng nhập Facebook (Facebook Login for Business)
1. Nếu menu trái chưa có **Facebook Login for Business**: thêm sản phẩm này (ứng dụng có use case phù hợp thường đã có sẵn).
2. Vào **Facebook Login for Business > Configurations > + Create configuration**.
3. Đặt tên cấu hình, chọn loại token **User access token**, chọn các quyền:
   - `pages_show_list`, `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`, `business_management`
   - thêm `instagram_basic`, `instagram_manage_messages` nếu nối Instagram.
4. Bấm **Create**. Meta cấp **Configuration ID**: copy (điền vào `META_LOGIN_CONFIG_ID`).
5. **Valid OAuth Redirect URIs**: thêm đúng địa chỉ `https://<tên-miền-của-KP-Chat>/api/connect/meta/callback` (khớp từng ký tự, kể cả `https`). **[chưa xác minh vị trí ô này: thường nằm trong cài đặt của sản phẩm Facebook Login for Business, mục Settings. Nếu không thấy, tìm "Valid OAuth Redirect URIs" trong phần Settings của sản phẩm đăng nhập.]**
6. Nếu không tạo được Configuration, để trống `META_LOGIN_CONFIG_ID`: KP Chat sẽ gửi danh sách quyền trực tiếp qua đăng nhập Facebook thông thường.

### 1.4 Thêm người thử
Menu trái **App Roles**: mời tài khoản Facebook thứ hai (người nhà, đồng nghiệp) vào làm **Tester** hoặc **Developer**; người đó phải nhận lời mời. **[chưa xác minh nhãn nút chính xác]** Quản trị Page nối kênh cũng cần có vai trò trên ứng dụng.

### 1.5 Chế độ của ứng dụng và khi nào cần Meta duyệt
- Ứng dụng loại **Business** không có công tắc Development/Live mà dùng **mức truy cập**: **Standard Access** (mặc định) chỉ dùng được với người có vai trò trên ứng dụng hoặc Page; **Advanced Access** cho phép phục vụ người dùng ngoài, và phải qua **App Review**.
- Ứng dụng loại có công tắc **App Mode** (thanh trên cùng) thì mặc định ở Development; Live mới cho mọi người dùng nhưng chỉ các quyền đã duyệt mới hoạt động.
- Chỉ nhắn thử trong nội bộ (người có vai trò): **không cần duyệt**.
- Cho khách thật nhắn vào Page: cần **Advanced Access** qua menu **Submit for review > App Review**, và có thể cần **Business Verification** (menu **Verification** cùng mục). Chuẩn bị: chính sách riêng tư, mô tả vì sao dùng từng quyền, video quay luồng sử dụng. Có thể mất vài ngày đến vài tuần. **Nên nộp sớm, song song với lúc thử nội bộ.** **[chưa xác minh danh sách quyền cần Advanced Access và checklist Go live đầy đủ]**

---

## Phần 2. Cho KP Chat chạy và nối Page

### 2.1 Cấu hình `.env.local` (trong thư mục `kp-chat`)
| Biến | Giá trị | Lấy ở đâu |
|---|---|---|
| `KPCHAT_SECRET_KEY` | đã tạo sẵn | không cần làm gì |
| `META_VERIFY_TOKEN` | đã tạo sẵn | không cần làm gì (chỉ dùng khi gõ tay webhook ở Meta) |
| `KPCHAT_ACCESS_KEY` | đã tạo sẵn | khóa để mở app khi đã công khai |
| `META_APP_ID` | số | Phần 1.2 |
| `META_APP_SECRET` | chuỗi | Phần 1.2 |
| `META_LOGIN_CONFIG_ID` | số (không bắt buộc) | Phần 1.3 |
| `KPCHAT_PUBLIC_URL` | `https://...` không có `/` cuối | Phần 2.2 |

**Không dán nội dung file này vào chat.**

### 2.2 Có địa chỉ công khai https
Meta chỉ gọi được địa chỉ công khai. Có hai cách:
- **Thử nhanh bằng đường hầm** (địa chỉ đổi mỗi lần chạy lại, nên mỗi lần đổi phải cập nhật Redirect URI và webhook):
  ```bash
  brew install cloudflared
  ```
  ```bash
  cloudflared tunnel --url http://localhost:3031
  ```
- **Dùng lâu dài:** đặt KP Chat trên máy chủ có tên miền cố định và HTTPS (xem "Trước khi dùng thật" ở cuối).

Điền địa chỉ vào `KPCHAT_PUBLIC_URL`, rồi **khởi động lại**:
```bash
cd "/Users/nguyenkhai/Documents/Cloude Code/kp-chat" && npm run dev
```
Cập nhật lại **Redirect URI** ở Meta (Phần 1.3 bước 5) và **App Domains** (Phần 1.2) cho đúng địa chỉ mới.

### 2.3 Mở KP Chat và chạy bộ kiểm tra
1. Mở `https://<địa-chỉ-công-khai>/?key=<KPCHAT_ACCESS_KEY>` (dùng đúng địa chỉ công khai, **không dùng localhost**). Chọn tư cách **Quản trị** (ô trên cùng bên phải).
2. **Cài đặt > Kết nối kênh > Kiểm tra cài đặt Meta.** Cửa sổ liệt kê từng điều kiện: đã có khóa ứng dụng, có địa chỉ công khai, Meta/internet gọi được webhook, App ID và App Secret được Meta chấp nhận, webhook của ứng dụng, từng Page. Điều kiện nào chưa đạt có chú thích cách sửa.
3. Khi dòng **"Ứng dụng chưa có webhook cho Page"** hiện và các điều kiện phía trên đã đạt: bấm **Tự cấu hình webhook**. KP Chat gọi Meta để đăng ký webhook (đối tượng Page, các trường `messages`, `message_echoes`, `messaging_postbacks`). Meta sẽ gọi về KP Chat để xác minh ngay lúc đó, nên đường hầm phải đang chạy. Bấm **Kiểm tra lại** để thấy dòng chuyển sang "Đạt".
   - Nếu bấm lỗi: có thể cấu hình tay ở Meta, menu **Webhooks**, đối tượng **Page**, Callback `https://<địa-chỉ-công-khai>/api/webhook/facebook`, Verify Token = `META_VERIFY_TOKEN`, rồi đăng ký các trường trên. **[chưa xác minh tên menu hiện tại]**
   - **Instagram:** Meta không cho đăng ký webhook Instagram qua API. Làm ở Meta: **Webhooks > Instagram** (hoặc Instagram settings), callback `https://<địa-chỉ-công-khai>/api/webhook/instagram`, cùng Verify Token, trường `messages`.

### 2.4 Nối Page
1. Bấm **Đăng nhập Facebook** (nút bật khi đã có `META_APP_ID` và `META_APP_SECRET`).
2. Đăng nhập Facebook bằng tài khoản **quản trị Page**. **Chấp nhận mọi quyền** và chọn các Page cho ứng dụng.
3. Quay về KP Chat, hộp **Chọn Page để nối** hiện ra. Tích Page (và Instagram liên kết nếu có), bấm **Nối**. Kết quả từng Page hiện ngay.
4. Chạy lại **Kiểm tra cài đặt Meta**: dòng của Page phải là "sẵn sàng nhận tin".
5. **Cài đặt > Phân quyền theo kênh**: thêm nhân viên vào kênh (mức Nhắn tin). Nhân viên **không cần quyền gì trên Facebook**.
6. Khi sẵn sàng thử trả lời: bật **Cho phép gửi tin** ở thẻ kênh.

---

## Phần 3. Thử thật
1. Từ tài khoản Facebook thứ hai (có vai trò Tester), nhắn vào Page.
2. Tin hiện ở **Hội thoại** trong vài giây.
3. Trả lời từ KP Chat (kênh đã bật gửi tin, trong 24 giờ kể từ tin của khách). Kiểm tra tin tới Messenger của tài khoản thử.
4. Trả lời từ ứng dụng Messenger hoặc Page Inbox của Facebook: tin hiện lại ở KP Chat nhờ `message_echoes`.
5. Thử thêm: chia khách xoay vòng, SLA, thư viện mẫu, ảnh.

**Chỉ thử bằng tài khoản của mình hoặc người thử đã biết. Không nhắn cho khách thật trong lúc thử.**

---

## Gỡ lỗi nhanh
Trước hết bấm **Kiểm tra cài đặt Meta**, nó chỉ ra điều kiện nào chưa đạt.

| Triệu chứng | Nguyên nhân thường gặp |
|---|---|
| Nút Đăng nhập Facebook mờ | Thiếu `META_APP_ID` hoặc `META_APP_SECRET`, hoặc chưa khởi động lại sau khi sửa `.env.local` |
| "Không gọi được địa chỉ công khai" | Đường hầm chưa chạy hoặc đã đổi địa chỉ: chạy lại và cập nhật `KPCHAT_PUBLIC_URL`, Redirect URI, App Domains |
| Tự cấu hình webhook báo lỗi | Đường hầm không truy cập được từ ngoài; khóa ứng dụng sai; Meta chưa cho ứng dụng dùng sản phẩm Webhooks |
| Facebook báo "URL không được phép" | Redirect URI chưa khớp từng ký tự với `.../api/connect/meta/callback` |
| Danh sách Page rỗng | Chưa tích Page ở bước đăng nhập, hoặc chưa cấp quyền `pages_show_list` |
| Page báo "Thiếu quyền Nhắn tin" | Tài khoản đăng nhập không có tác vụ Nhắn tin trên Page đó |
| Nối được nhưng tin không về | Chưa đăng ký trường `messages`; người nhắn chưa có vai trò trên ứng dụng (chưa có Advanced Access); Page chưa đăng ký ứng dụng |
| Trả lời lỗi | Kênh chưa bật gửi tin; quá 24 giờ kể từ tin cuối của khách; token bị thu hồi (đăng nhập Facebook lại) |
| Mất kết nối sau khi đổi địa chỉ đường hầm | Cập nhật `KPCHAT_PUBLIC_URL`, Redirect URI và bấm Tự cấu hình webhook |

## Bảo mật khi mở ra Internet (quan trọng)
Bản chạy thử **chưa có đăng nhập thật**: ai mở được địa chỉ đều làm được quản trị (xem tin khách, gửi tin, lấy token đã nối). Vì vậy:
- Khi đã điền `KPCHAT_PUBLIC_URL`, KP Chat **từ chối mọi yêu cầu** nếu chưa đặt `KPCHAT_ACCESS_KEY` (tối thiểu 16 ký tự). Khóa đã tạo sẵn trong `.env.local`.
- Lần đầu mở bằng `?key=<khóa>`; trình duyệt nhớ 30 ngày bằng cookie.
- Chỉ webhook của nền tảng (có chữ ký riêng) và ảnh gửi khách (tên tệp ngẫu nhiên) không cần khóa.
- Không gửi địa chỉ có `?key=` cho người khác. Tắt đường hầm khi không dùng.

## Trước khi dùng thật cho khách (chưa làm xong)
| Việc | Tình trạng |
|---|---|
| Meta duyệt Advanced Access (khách ngoài vai trò nhắn được) | Việc của anh; nộp sớm |
| Chạy trên máy chủ có tên miền cố định, HTTPS | Chưa làm (hiện chạy trên máy anh) |
| Đăng nhập thật cho nhân viên (đang chỉ có công tắc người dùng thử) | Chưa làm: cần host adapter nối vào tài khoản KPF |
| Lưu dữ liệu vào cơ sở dữ liệu thay cho tệp JSON (chịu nhiều người, sao lưu) | Chưa làm (kế hoạch Supabase) |
| Hàng đợi xử lý webhook (Meta yêu cầu trả lời trong 5 giây) | Chưa làm |
| Thông báo cho nhân viên khi có tin mới, khi sắp vượt SLA | Chưa làm |
| Zalo OA, TikTok | Đã viết, chưa thử với tài khoản thật |

Vì vậy hiện tại KP Chat phù hợp để **thử nội bộ bằng Page của anh**, chưa nên giao cho nhân viên dùng hằng ngày với khách thật.

---

## Tên menu thực tế trong giao diện tiếng Việt (đã xem trên ứng dụng "KP Chat", 21/11/2026)
| Việc | Đường dẫn trong trang Meta |
|---|---|
| Quyền của trường hợp sử dụng Messenger | **Trường hợp sử dụng > Tùy chỉnh > Messenger from Meta > Quyền và tính năng** (bấm **Thêm** ở quyền cần) |
| Cấu hình webhook, kết nối Trang, xét duyệt | cùng chỗ, tab **Cài đặt API Messenger**: "1. Đặt cấu hình webhook" (ô URL gọi lại, Xác minh mã, nút Xác minh và lưu), "2. Tạo mã truy cập" (Kết nối Trang), "3. Hoàn tất quy trình Xét duyệt ứng dụng" |
| URI chuyển hướng OAuth | **Đăng nhập bằng Facebook cho doanh nghiệp > Cài đặt > URI chuyển hướng OAuth hợp lệ** (đang giữ Chế độ sử dụng nghiêm ngặt: phải khớp từng ký tự) |
| Configuration ID | **Đăng nhập bằng Facebook cho doanh nghiệp > Cấu hình > Tạo cấu hình** |
| App ID, khóa bí mật, miền, chính sách | **Cài đặt ứng dụng > Thông tin cơ bản** ("Khóa bí mật của ứng dụng" bấm Hiển thị) |
| Mời người thử | **Vai trò trong ứng dụng > Vai trò** và **Người dùng thử nghiệm** |
| Phát hành, xét duyệt | **Đăng** (trạng thái "Chưa đăng") |

Meta ghi rõ trong tab Cài đặt API Messenger: trong lúc phát triển, ứng dụng chỉ nhắn được với người có vai trò Quản trị viên, Nhà phát triển hoặc Người dùng thử; mọi ứng dụng Messenger phải qua xét duyệt trước khi tương tác với người dùng khác.

---

## Phần 4. Nối Instagram (viết 22/11/2026, đối chiếu tài liệu Meta; CHƯA thử với tài khoản Instagram thật)
KP Chat nhận tin Instagram qua **Page liên kết** (đường "Messenger API for Instagram" với Facebook Login): webhook về `/api/webhook/instagram`, gửi trả lời qua `POST /{PAGE_ID}/messages` với người nhận là mã Instagram của khách (IGSID). Dùng chung token Page với kênh Messenger.

### 4.1 Cần có
- Tài khoản Instagram **chuyên nghiệp** (Business hoặc Creator).
- Đã **liên kết với một Page Facebook** (Instagram > Chỉnh sửa trang cá nhân > Page; hoặc Page > Cài đặt > Tài khoản được liên kết).
- Người nối có tác vụ quản lý Page đó (cùng điều kiện với Messenger).
- Cấu hình đăng nhập Facebook for Business có thêm hai quyền `instagram_basic` và `instagram_manage_messages` (Phần 1.3 bước 3). Cấu hình `KP Chat Messenger` hiện chỉ có 5 quyền Messenger: **tạo cấu hình mới hoặc sửa cấu hình**, rồi điền Configuration ID vào `META_LOGIN_CONFIG_ID` và khởi động lại.

### 4.2 Các bước
1. **Ở ứng dụng Instagram trên điện thoại** (tài khoản chuyên nghiệp): Cài đặt > Tin nhắn và phản hồi tin cá nhân > Điều khiển tin nhắn > Công cụ được kết nối > bật **Cho phép truy cập tin nhắn** (tên tiếng Anh: Allow access to messages). Không bật thì Meta không chuyển tin về KP Chat. **[chưa xác minh]** vị trí menu đúng trên bản Instagram tiếng Việt hiện tại; tìm "Công cụ được kết nối".
2. **Nối trong KP Chat:** Cài đặt > Kênh > Thêm kênh > Page Facebook và Instagram, đăng nhập Facebook (chấp nhận cả quyền Instagram), ở hộp "Chọn Page để nối" tích Page và tích **@tên_instagram** ở cột "Instagram liên kết". Nếu cột đó trống ("—") dù Page đã liên kết thì Meta không trả `instagram_business_account`: xem 4.4.
3. **Webhook Instagram** (Meta không cho đăng ký qua API, làm tay): Meta for Developers > ứng dụng KP Chat > **Webhooks** (hoặc Messenger > Cài đặt Instagram), chọn sản phẩm **Instagram**, Callback URL = `https://<tên-miền>/api/webhook/instagram`, Verify Token = giá trị `META_VERIFY_TOKEN`, bấm Xác minh và lưu, rồi **đăng ký trường `messages`** (có thể thêm `message_reactions`, `messaging_seen`, KP Chat bỏ qua các loại này). Tin do chính tài khoản gửi (echo) đi trong trường `messages`. **[chưa xác minh]** tên menu chính xác; Meta nói thao tác làm ở "Webhooks for your Instagram API setup".
4. Chạy **Kiểm tra cài đặt Meta**: dòng "IG ...: Page liên kết đã đăng ký nhận tin" phải Đạt; dòng "Instagram: webhook làm ở App Dashboard" nhắc đủ hai việc ở bước 1 và 3.
5. **Ứng dụng phải ở trạng thái Đã đăng (Published)** mới nhận webhook Instagram; trong lúc phát triển chỉ tin của người có vai trò trên ứng dụng (Quản trị, Nhà phát triển, Người dùng thử) về được. Cho tài khoản Instagram thử **vai trò Người dùng thử**.
6. **Thử:** từ tài khoản Instagram thử (có vai trò) nhắn vào tài khoản chuyên nghiệp. Tin hiện ở Hội thoại, kênh kiểu "Instagram". Bật **Cho phép gửi tin** ở thẻ kênh rồi trả lời; kiểm tra tin tới ứng dụng Instagram của tài khoản thử. Nhớ: chỉ trả lời được trong 24 giờ.

### 4.3 Hành vi cần biết
- Chỉ nhắn lại được người **đã nhắn trước**; tin gif và sticker khách gửi không về webhook; tin loại Meta không chuyển được hiện dòng "[Tin nhắn Instagram chưa hiển thị được]".
- Tin thử gửi cho chính tài khoản (`is_self`), lượt đã xem, biểu cảm: KP Chat bỏ qua.
- Tên khách: lấy bằng IGSID (`name`, `username`, `profile_pic`); Meta chỉ trả khi khách đã nhắn.
- Giới hạn chữ: tài liệu Instagram Login ghi tối đa 1000 byte mỗi tin; với đường Page **[chưa xác minh]**. Tin dài có thể bị Meta từ chối và lỗi hiện nguyên văn ở khung chat.
- Quá 24 giờ: xem Human Agent trong `docs/META-NOP-DUYET.md` (tắt mặc định).

### 4.4 Gỡ lỗi Instagram
| Triệu chứng | Nguyên nhân thường gặp |
|---|---|
| Cột Instagram liên kết trống | Page chưa liên kết Instagram chuyên nghiệp; chưa cấp `instagram_basic`; Meta không trả trường `instagram_business_account` (code chỉ đọc trường này). Thử đăng nhập lại và chấp nhận đủ quyền |
| Nối được nhưng tin không về | Chưa bật "Cho phép truy cập tin nhắn"; chưa đăng ký webhook Instagram và trường `messages`; ứng dụng chưa Đã đăng; người nhắn không có vai trò; Page liên kết chưa đăng ký nhận tin (kiểm tra cài đặt báo "Page liên kết chưa đăng ký nhận tin") |
| Có tin về máy chủ nhưng không vào hộp thư | Nhật ký máy chủ có dòng `[webhook:instagram] ... tin không khớp kênh nào đang nối (mã nhận: ...)`: so mã đó với mã kênh trong Chi tiết kênh. KP Chat khớp theo id tài khoản Instagram và, nếu Meta gửi id Page, theo Page liên kết |
| Trả lời báo lỗi Meta | Mã 10 thường là quá 24 giờ hoặc thiếu quyền; mã 190 token hết hạn: Kết nối lại |
