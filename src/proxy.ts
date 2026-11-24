import { NextResponse, type NextRequest } from "next/server";
import { gate } from "./gate";
import { browserOrigin } from "./core/origin";

export function proxy(req: NextRequest) {
  const url = req.nextUrl;
  const g = gate({
    pathname: url.pathname,
    queryKey: url.searchParams.get("key"),
    cookieKey: req.cookies.get("kp_key")?.value,
    env: { KPCHAT_PUBLIC_URL: process.env.KPCHAT_PUBLIC_URL, KPCHAT_ACCESS_KEY: process.env.KPCHAT_ACCESS_KEY },
  });
  if (g.action === "allow") return NextResponse.next();
  if (g.action === "deny") return new NextResponse(g.message, { status: g.status, headers: { "content-type": "text/plain; charset=utf-8" } });
  // Chuyển hướng về đúng tên miền trình duyệt đang mở (header Host): sau proxy (Render), url có thể mang địa chỉ nội bộ
  const rest = new URLSearchParams(url.search);
  rest.delete("key");
  const res = NextResponse.redirect(`${browserOrigin(req.headers, req.url).origin}${g.redirect}${rest.size ? `?${rest}` : ""}`, 307);
  res.cookies.set("kp_key", g.key, { httpOnly: true, sameSite: "lax", secure: url.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
