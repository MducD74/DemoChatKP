# Cài KP Chat 2.0 cho các hệ thống KP khác (KP LBF, KP Travel, KP Xuxi…)

Cập nhật 24/11/2026. Theo kiến trúc đã chốt ở `docs/KIEN-TRUC-ONLINE.md`, **KP Chat là một dịch vụ riêng**: một máy chủ, một kho dữ liệu, một ứng dụng Meta, một tên miền. Các hệ thống KP không chép mã KP Chat vào mình. Chúng **nhúng giao diện** hoặc **gọi API** của KP Chat.

> Phần đăng nhập (mục 1.2 của yêu cầu) đang tạm bỏ qua. Mục 3 dưới đây là **thiết kế đề xuất** cho lớp nối đó, chưa làm. Hiện KP Chat dùng khóa truy cập chung và ô chọn vai trò thử.

## 1. Mỗi hệ thống KP là gì trong KP Chat
- Dữ liệu của KP Chat đã có trường `companyId` trên kênh, khách, hội thoại và tin. Mỗi hệ thống hoặc thương hiệu (Xuxi, LBF, KP Travel) là một `companyId`.
- **Thương hiệu** (tab KP AIbot > Thương hiệu) gom kênh, tài liệu và chatbot của một thương hiệu, để chatbot không trả lời lẫn thông tin giữa các thương hiệu.
- Kênh (Page, OA) nối một lần ở KP Chat. Nhân viên không cần quyền gì trên Facebook hay Zalo.

## 2. Các bước thêm một hệ thống mới (khi đã có lớp đăng nhập ở mục 3)
1. **Quản trị KP Chat** tạo thương hiệu mới, nối Page hoặc OA của thương hiệu đó (Cài đặt > Kênh), gắn kênh vào thương hiệu.
2. **Phân quyền theo kênh**: thêm nhân viên của hệ thống đó vào kênh (Nhắn tin hoặc Chỉ xem). Nhân viên dùng tài khoản của hệ thống KP, KP Chat không giữ mật khẩu.
3. **Trong hệ thống KP**:
   - thêm mục "KP Chat" vào menu, mở trang KP Chat trong iframe kèm token ngắn hạn (mục 3). Chế độ nhúng (ẩn thanh bên của KP Chat) **chưa có**, sẽ làm cùng mục 3;
   - mở thẳng một hội thoại bằng `/?c=<mã hội thoại>` (đã có), ví dụ từ hồ sơ khách hay từ thông báo.
4. **Kiến thức chatbot**: nhập tài liệu của thương hiệu ở KP AIbot > Kiến thức, tạo chatbot ở chế độ Soạn nháp, chạy bộ 40 câu ở mục Đánh giá trước khi cho nhân viên dùng.
5. **Thử**: nhắn vào Page hoặc OA thử, kiểm theo các tiêu chí ở tài liệu yêu cầu (mục 2 đến 5).

## 3. Lớp nối đăng nhập (đề xuất, CHƯA LÀM: mục 1.2)
Chỗ cắm đã có: `src/core/host.ts` (giao diện `HostAdapter`) và `actorOf()` trong `src/server.ts`. Hiện `actorOf()` đọc cookie vai trò thử; khi làm, đổi sang đọc token.

**Token do hệ thống KP ký** (JWT HS256 hoặc tương đương, sống 5 đến 15 phút), gửi khi mở iframe:
```
{ "iss": "kp-xuxi", "sub": "<uid nhân viên>", "name": "Nguyễn Văn A", "role": "admin" | "agent",
  "companyId": "xuxi", "channels": ["<mã kênh>", ...] (tuỳ chọn), "exp": ... }
```
- KP Chat kiểm chữ ký bằng khóa chung của từng hệ thống (biến môi trường, ví dụ `KPCHAT_HOST_KEY_KP_XUXI`), rồi đổi sang phiên cookie của KP Chat (httpOnly, `SameSite=None; Secure` vì nằm trong iframe khác tên miền).
- **Mở từ KP Xuxi thì vào thẳng** (yêu cầu 1.2): KP Xuxi tự ký token cho người đang đăng nhập, nên không phải đăng nhập lại.
- Vai trò: `admin` thấy mọi kênh của công ty mình; `agent` thấy kênh được phân quyền (luật hiện có, kiểm ở máy chủ).
- Danh sách nhân viên (để giao khách, chia khách) lấy từ hệ thống KP qua `HostAdapter`, thay cho `DEMO_STAFF`.
- Bỏ `KPCHAT_ACCESS_KEY` và ô "Đang dùng với tư cách" khi đã chạy lớp này.

**Cần hệ thống KP cung cấp**: tên `iss`, khóa ký chung (trao qua kênh an toàn, không qua chat), cách ánh xạ vai trò của họ sang `admin` hoặc `agent`, và URL trang để KP Chat quay về khi phiên hết hạn.

## 4. Giao diện thống nhất với các hệ thống KP
- `src/app/kpf-base.css` là bản sao nguyên văn `globals.css` của KPF. `src/components/ui.tsx` chép các thành phần chuẩn (TopTabs, FilterBar, Modal, Chip…) đúng tên lớp CSS.
- Lớp riêng của KP Chat có tiền tố `.kc-` (`src/components/pages/chat.css`) nên không đè lên giao diện của hệ thống chủ.

## 5. Nối CRM, đơn hàng, nhiệm vụ (sau)
Xem bảng đối chiếu `docs/DOI-CHIEU-KP-CHAT-1-VA-2.md`. Nguyên tắc: **không làm lại CRM trong KP Chat**. Hệ thống KP cung cấp ba cổng qua `HostAdapter`:
- hồ sơ khách theo số điện thoại;
- danh mục sản phẩm (giá, tồn kho);
- ghi lead.

KP Chat gọi các cổng này; cổng nào chưa có thì tính năng tương ứng bị ẩn.
