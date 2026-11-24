// Chạy một lần khi máy chủ Next.js bật (trước khi nhận yêu cầu): khởi động các việc nền không phụ thuộc yêu cầu nào,
// để sao lưu hằng ngày và kiểm tra cảnh báo vẫn chạy sau khi máy chủ khởi động lại dù chưa ai mở trang.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await (await import("./instrumentation-node")).start();
}
