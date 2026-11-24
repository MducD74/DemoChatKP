import { NextResponse, after } from "next/server";
import { getAdapter } from "@/core/adapter";
import { ingest } from "@/core/ingest";
import { enrichProfiles } from "@/core/profile";
import { localizeMedia } from "@/core/inboundmedia";
import { markWebhook } from "@/core/webhookstate";
import { boot, store } from "@/server";

// Meta gọi GET này một lần khi đăng ký webhook.
export async function GET(req: Request, ctx: { params: Promise<{ kind: string }> }) {
  boot();
  const { kind } = await ctx.params;
  const adapter = getAdapter(kind);
  if (!adapter?.challenge) return NextResponse.json({ error: "kênh không hỗ trợ" }, { status: 404 });
  const body = adapter.challenge(new URL(req.url).searchParams);
  return body === null ? new NextResponse("forbidden", { status: 403 }) : new NextResponse(body, { status: 200 });
}

export async function POST(req: Request, ctx: { params: Promise<{ kind: string }> }) {
  boot();
  const { kind } = await ctx.params;
  const adapter = getAdapter(kind);
  if (!adapter) return NextResponse.json({ error: "kênh không hỗ trợ" }, { status: 404 });
  const raw = await req.text();
  if (!adapter.verify(req.headers, raw)) {
    // Hay gặp khi META_APP_SECRET ở máy chủ khác App Secret của ứng dụng đang gửi webhook: tin bị bỏ mà không ai biết
    console.warn(`[webhook:${kind}] bỏ tin vì sai chữ ký${req.headers.get("x-hub-signature-256") ? "" : " (không có chữ ký)"}: kiểm META_APP_SECRET có đúng App Secret của ứng dụng Meta không`);
    return NextResponse.json({ error: "sai chữ ký" }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "JSON lỗi" }, { status: 400 });
  }
  markWebhook(kind); // gọi tới được và đúng chữ ký: webhook đang sống
  const events = adapter.parse(payload);
  const { needProfile, newMedia, ...result } = await ingest(store, kind, events);
  // Nhật ký để lần lỗi "nối rồi mà tin không về" (không ghi nội dung tin, chỉ mã kênh)
  if (result.unknownChannel) console.warn(`[webhook:${kind}] ${result.unknownChannel} tin không khớp kênh nào đang nối (mã nhận: ${[...new Set(events.map((e) => e.channelExternalId))].join(", ")})`);
  // Lấy tên và ảnh khách sau khi đã trả lời Meta (Meta chờ phản hồi nhanh)
  if (needProfile.length) after(() => enrichProfiles(store, kind, needProfile).catch(() => undefined));
  // Ảnh khách gửi: tải từ CDN của Meta về kho ảnh của KP Chat (đường dẫn của Meta hết hạn sau một thời gian)
  if (newMedia.length && (kind === "facebook" || kind === "instagram")) after(() => localizeMedia(store, newMedia).catch(() => undefined));
  return NextResponse.json({ ok: true, ...result });
}
