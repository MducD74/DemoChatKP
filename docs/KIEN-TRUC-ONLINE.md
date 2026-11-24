# Kiến trúc khi lên online: KP Chat là dịch vụ riêng, các dự án nhúng vào (chốt ngày 22/11/2026)

Thay cho hướng "đưa lõi KP Chat vào từng ứng dụng KPF" ghi ở `KE-HOACH-2.0.md`. Anh Khai đề xuất, tôi đồng ý vì hợp lý hơn.

## Ý chính
- **Một dịch vụ KP Chat riêng, một kho dữ liệu riêng**, tách hẳn khỏi cơ sở dữ liệu của KPF LBF, XuXi, LabanFood, KP Travel. Lý do: dữ liệu chat mỗi ngày rất nhiều, không nên đè lên kho của các dự án; một khách có thể nhắn nhiều Page, nhiều kênh nên cần một nơi giữ chung; Meta, Zalo, TikTok chỉ cần một ứng dụng, một tên miền, một webhook.
- **Các dự án nhúng/lấy từ KP Chat** giống cách đang lấy từ Pancake: KP Chat có API cho dự án gọi (danh sách hội thoại, tin, gửi tin, thống kê) và/hoặc trang giao diện nhúng sẵn. KP Chat 1.1 trong KPF hiện đọc Pancake; sau này đổi nguồn sang KP Chat 2.0.

## Các phần
1. **Dịch vụ KP Chat** chạy liên tục trên Railway (container, một tiến trình nền cho Zalo cá nhân), tên miền `kpchat.laban.asia` (CNAME ở Tenten). Một tên miền này dùng chung cho webhook Meta, Zalo OA, TikTok và xác thực domain.
2. **Cơ sở dữ liệu riêng** (Postgres: dự án Supabase mới hoặc Postgres của Railway). Mô hình dữ liệu đã có `companyId` trên kênh, khách, hội thoại, tin: dùng làm "dự án/thương hiệu" (XuXi, LabanFood, KP Travel...). Ảnh và tệp đưa lên kho tệp (object storage). Tin cũ lưu trữ theo phân vùng hoặc dọn theo thời hạn.
3. **Đăng nhập và phân quyền do dự án chủ lo (host adapter)**: nhân viên đăng nhập ở KPF như hiện nay; KPF ký một token ngắn hạn chứa `uid`, vai trò, phòng ban, các kênh được vào; KP Chat tin token đó, không giữ danh sách người dùng riêng. Luật phân quyền theo kênh của KP Chat vẫn giữ.
4. **Nhúng giao diện**: trang `/chat` của mỗi dự án nhúng khung KP Chat (iframe hoặc gói giao diện chung) kèm token; dự án nào cần giao diện riêng thì gọi API.
5. **Tương thích Pancake**: ưu tiên giữ hình dạng dữ liệu gần với cái KP Chat 1.1 đang đọc từ Pancake để chuyển nguồn ít sửa.

## Việc phải làm (chưa làm gì ở đây)
- Chọn nơi đặt cơ sở dữ liệu và chi phí (số liệu chi phí chưa kiểm chứng).
- Đổi kho JSON (`data/chat.json`) sang Postgres qua giao diện kho đã có (`Store`): `load/save` hiện đọc cả tệp, không hợp với dữ liệu lớn; cần truy vấn theo hội thoại, phân trang, chỉ mục.
- Hàng đợi cho webhook (không mất tin khi dịch vụ bận), nhận ra tin trùng, thông báo.
- Host adapter: định dạng token, khoá ký chung, ánh xạ vai trò KPF sang vai trò KP Chat.
- Bảo mật khi mở ra mạng: thay khoá truy cập chung và công tắc chọn vai trò thử bằng đăng nhập thật qua token.
- Chạy song song với KP Chat 1.1 (Pancake), chuyển từng kênh, giữ Pancake làm nguồn cho TikTok cho tới khi TikTok duyệt.
- KPF LBF và các dự án khác chỉ sửa theo quy tắc của từng dự án (không commit hay đẩy tay).

## Khôi phục tin lỡ khi webhook ngắt (làm ngày 22/11/2026)
- Đường hầm cloudflared tạm chết âm thầm (tiến trình còn nhưng Meta gọi không tới): tin mới không về. Đã thêm: `GET /api/channels/webhook-status` (gọi thử địa chỉ công khai như Meta xác minh) và banner đỏ ở Cài đặt > Kênh khi không truy cập được; ghi lại lần cuối nhận tin qua webhook (`src/core/webhookstate.ts`).
- **Khôi phục tin lỡ**: `POST /api/channels/<id>/history { mode: "catchup", hours }` cho một kênh, `POST /api/channels/catchup { hours }` cho mọi kênh Meta. Khác "Tải tin cũ": ghi như tin mới (mở lại hội thoại, chia khách, báo chưa đọc) nhưng không đánh thức chatbot (`ingest` có `catchUp`). Bắt buộc có số giờ (1 đến 168).
- Khi lên máy chủ thật với tên miền cố định thì ít chết hơn nhưng vẫn nên giữ chức năng này.
