# Zalo OA: các bước còn thiếu để nối OA thật (yêu cầu 2.6)

Cập nhật 24/11/2026. Công ty **chưa cấp OA thử**, nên phần này chưa thử với OA thật. Adapter Zalo OA đã viết xong (`src/adapters/zalo.ts`) và đã kiểm bằng dữ liệu giả.

## Đã có trong KP Chat
- Nhận webhook tin khách gửi tới OA: chữ, ảnh, liên kết, âm thanh, video, sticker, vị trí, tệp, danh thiếp. Có kiểm chữ ký `X-ZEvent-Signature`.
- Gửi tin Tư vấn (chữ, một ảnh jpg/png tối đa 1MB mỗi tin) trong cửa sổ 7 ngày kể từ lần tương tác cuối của khách; quá hạn thì ô soạn bị khóa.
- Cấp quyền OAuth có PKCE ở Cài đặt > Kênh > Thêm kênh > Zalo OA. Hệ thống tự làm mới access token (25 giờ) bằng refresh token. Refresh token chỉ dùng được một lần và được lưu ngay, đã mã hóa.
- Lấy tên và ảnh khách (với người đã quan tâm hoặc đã tương tác với OA).
- Chống trùng tin, cảnh báo, sao lưu: dùng chung với Messenger.

## Cần công ty cung cấp
1. **Một OA thử** (không phải OA thật của Xuxi Fruit), cùng quyền quản trị OA đó cho người thực hiện.
2. **Ứng dụng trên Zalo for Developers** (developers.zalo.me) gắn với OA thử: App ID và khóa bí mật của ứng dụng. Đặt vào biến môi trường `ZALO_APP_ID`, `ZALO_APP_SECRET`, không gửi qua chat.
3. **Tên miền cố định HTTPS** đã chạy KP Chat (mục 1.1 của yêu cầu, đang tạm bỏ qua). Zalo không nhận địa chỉ đường hầm tạm.
4. **Tài khoản Zalo thử** đóng vai khách (đã quan tâm OA thử).

## Các bước khi đã có những thứ trên
1. Ở Zalo for Developers, trong ứng dụng:
   - **Xác thực tên miền**: thêm thẻ meta hoặc tải tệp HTML. Cần thêm một route nhỏ phục vụ tệp đó; việc này mất khoảng 15 phút khi có tệp.
   - **Webhook**: URL `https://<tên miền>/api/webhook/zalo_oa`, bật các sự kiện "người dùng gửi tin nhắn" (`user_send_text`, `user_send_image`...).
   - **Official Account > URL chuyển hướng**: `https://<tên miền>/api/connect/zalo/callback`.
   - Điền số điện thoại, email liên hệ và **kích hoạt** ứng dụng.
2. Đặt biến môi trường trên Railway, rồi Redeploy.
3. Ở KP Chat, vào Cài đặt > Kênh > Thêm kênh > Zalo OA, bấm **Cấp quyền**, đăng nhập bằng tài khoản quản trị OA thử.
4. Từ tài khoản thử, nhắn vào OA. Tin phải hiện trong KP Chat sau vài giây. Sau đó bật **Cho phép gửi tin** ở kênh và trả lời thử, gồm cả chữ và ảnh.
5. Phân quyền nhân viên vào kênh ở Cài đặt > Phân quyền theo kênh.

## Điểm chưa xác minh (sẽ rõ ngay ở lần thử đầu)
| Điểm | Nếu sai thì thấy gì | Sửa |
|---|---|---|
| Chữ ký webhook dùng khóa bí mật của ứng dụng hay "OA secret key" riêng | Webhook bị trả 401 "sai chữ ký" | Thêm biến riêng cho khóa ký webhook (sửa nhỏ trong `adapters/index.ts`) |
| URL cấp quyền cần thêm `code_challenge_method=S256` | Zalo báo lỗi ở bước cấp quyền | Thêm tham số trong `zaloAuthUrl` (`src/core/connect.ts`) |
| Đổi mã cấp quyền lần đầu ở endpoint v4 có nhận `code_verifier` | Lỗi khi quay về từ Zalo | Đổi endpoint theo thông báo lỗi |
| Tin nhân viên trả lời bằng app Zalo OA (sự kiện `oa_send_*`) | Tin đó không hiện trong KP Chat | Chưa làm: cần kiểm `msg_id` để không nhân đôi tin |

## Giới hạn đã biết
- Chưa gửi tệp (pdf, docx) qua Zalo OA, chỉ chữ và ảnh.
- Chưa kiểm hạn mức tin gửi ngoài 48 giờ: Zalo có thể tính phí hoặc giới hạn.
