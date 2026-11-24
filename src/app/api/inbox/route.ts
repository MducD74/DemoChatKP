import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { actorOf, boot, store } from "@/server";
import { listChannels, listConversations, runEscalations, touchSeen, unreadCount } from "@/core/service";
import { DEMO_STAFF } from "@/core/staff";
import { humanAgentEnabled } from "@/core/metahuman";
import { botList } from "@/core/chatbot";

export const dynamic = "force-dynamic";
const DEFAULT_LIMIT = 300;

export async function GET(req: Request) {
  boot();
  const sp = new URL(req.url).searchParams;
  const actor = actorOf(req);
  if (actor.role === "agent") await touchSeen(store, actor.uid); // đang mở KP Chat = trực tuyến
  await runEscalations(store);
  const assignee = sp.get("assignee");
  const botsAll = botList(await store.load()).map((b) => ({ id: b.id, name: b.name, type: b.type, channelIds: b.channelIds })); // chatbot để lọc (chỉ tên và loại)
  const [items, channels, unread] = await Promise.all([
    listConversations(store, {
      status: sp.get("status") ?? undefined,
      channelId: sp.get("channel") ?? undefined,
      q: sp.get("q") ?? undefined,
      assignee: assignee === "me" || assignee === "none" ? assignee : "all",
      actor,
    }),
    listChannels(store),
    unreadCount(store, actor),
  ]);
  // Chỉ gửi phần đầu danh sách (đã xếp: cần người, chưa đọc, mới nhất); giao diện bấm "Xem thêm" để tăng giới hạn.
  // Có nhiều hội thoại thì danh sách đầy đủ rất nặng cho điện thoại khi hỏi lại mỗi vài giây.
  const limit = Math.min(Math.max(Number(sp.get("limit")) || DEFAULT_LIMIT, 50), 5000);
  // Chỉ gửi thông tin tối thiểu của kênh cho giao diện hộp thư (không có id ngoài, token)
  const body = JSON.stringify({
    items: items.slice(0, limit),
    total: items.length,
    channels: channels.map((c) => ({ id: c.id, name: c.name, kind: c.kind, sendEnabled: c.sendEnabled, off: !!c.off })),
    unread,
    bots: botsAll,
    needHuman: items.filter((i) => i.needHuman && i.status !== "resolved").length, // hội thoại bot đã chuyển người, chưa ai xử lý (chỉ tính những cái người này được xem)
    humanAgent: humanAgentEnabled(), // Meta Human Agent bật: hộp soạn Messenger/Instagram mở tới 7 ngày
    me: actor,
    staff: DEMO_STAFF,
  });
  // Danh sách không đổi từ lần hỏi trước: trả 304, không gửi lại cả danh sách
  const etag = `W/"${createHash("sha1").update(body).digest("base64url")}"`;
  if (req.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers: { etag, "cache-control": "no-cache" } });
  return new NextResponse(body, { headers: { "content-type": "application/json; charset=utf-8", etag, "cache-control": "no-cache" } });
}
