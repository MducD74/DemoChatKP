import { NextResponse } from "next/server";
import { adminOnly, boot, loginBase, store } from "@/server";
import { beginMetaLogin } from "@/core/connect";
import { metaLoginUrl } from "@/core/metalogin";

export async function GET(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const appId = process.env.META_APP_ID, appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) return NextResponse.json({ ok: false, error: "Chưa đặt META_APP_ID và META_APP_SECRET" }, { status: 400 });
  const rerequest = new URL(req.url).searchParams.get("rerequest") === "1";
  const state = await beginMetaLogin(store, Date.now(), rerequest);
  console.info(`[meta-login] bắt đầu đăng nhập: config_id=${!!process.env.META_LOGIN_CONFIG_ID} rerequest=${rerequest} chuyển hướng về ${loginBase(req)}`);
  const url = metaLoginUrl({ appId, appSecret, redirectUri: `${loginBase(req)}/api/connect/meta/callback`, configId: process.env.META_LOGIN_CONFIG_ID, rerequest }, state);
  return NextResponse.json({ ok: true, url });
}
