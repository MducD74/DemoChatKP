import { boot, baseUrl, store } from "@/server";
import { webChannel } from "@/core/webchat";
import { widgetScript } from "@/core/webwidget";

export const dynamic = "force-dynamic";

// Script khung chat nhúng: <script src=".../api/web/widget.js?key=..." async></script>
export async function GET(req: Request) {
  boot();
  const key = new URL(req.url).searchParams.get("key");
  const ch = await webChannel(store, key);
  const h = { "content-type": "application/javascript; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=300" };
  if (!ch || !key) return new Response("/* KP Chat: khung chat không tồn tại hoặc đã tắt */", { status: 404, headers: h });
  return new Response(widgetScript(baseUrl(req), key), { headers: h });
}
