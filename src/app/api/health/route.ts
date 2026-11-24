import { NextResponse } from "next/server";
import { boot, store } from "@/server";

export const dynamic = "force-dynamic";

// Kiểm tra máy chủ còn sống (Railway healthcheck, theo dõi ngoài). Công khai, không trả dữ liệu nào của khách.
// Đọc kho dữ liệu: tệp hỏng hoặc ổ đĩa lỗi thì trả 503 để nền tảng biết bản này không chạy được.
export async function GET() {
  boot();
  try {
    await store.load();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Không đọc được kho dữ liệu" }, { status: 503 });
  }
}
