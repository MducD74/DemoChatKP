// Đăng ký adapter theo cấu hình môi trường. Không có cấu hình thật thì dùng adapter giả.
import { registerAdapter } from "@/core/adapter";
import type { Store } from "@/core/store";
import { staticTokens, storeBackedTokens } from "@/core/token-store";
import { createMetaAdapter } from "./meta";
import { createZaloAdapter } from "./zalo";
import { createTikTokAdapter } from "./tiktok";
import { mockAdapter } from "./mock";
import { zaloPersonalAdapter } from "./zalo-personal";
import { webAdapter } from "./web";
import { humanAgentEnabled } from "@/core/metahuman";
import { ZALO_PERSONAL_ENABLED } from "@/core/guardrails";

let done = false;
export function initAdapters(store: Store) {
  if (done) return;
  done = true;
  const secret = process.env.META_APP_SECRET;
  const verifyToken = process.env.META_VERIFY_TOKEN;
  if (secret && verifyToken) {
    // Token trang lưu mã hóa trong kho (nhập ở màn hình kết nối); còn biến môi trường META_TOKEN_<id> để thử nhanh.
    const statics = staticTokens(store);
    const getToken = async (ch: { id: string; externalId: string }) =>
      (await statics.get(ch.id)) ?? process.env[`META_TOKEN_${ch.externalId}`] ?? null;
    // Human Agent (trả lời quá 24 giờ) tắt mặc định, chỉ bật bằng META_HUMAN_AGENT=1 sau khi Meta duyệt
    const humanAgent = () => humanAgentEnabled();
    registerAdapter(createMetaAdapter({ kind: "facebook", appSecret: secret, verifyToken, getToken, humanAgent }));
    registerAdapter(createMetaAdapter({ kind: "instagram", appSecret: secret, verifyToken, getToken, humanAgent }));
  } else {
    registerAdapter(mockAdapter);
  }
  const ttKey = process.env.TIKTOK_CLIENT_KEY;
  const ttSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (ttKey && ttSecret) {
    registerAdapter(createTikTokAdapter({ clientKey: ttKey, clientSecret: ttSecret, tokens: storeBackedTokens(store) }));
  }
  registerAdapter(webAdapter); // khung chat nhúng trên web, không cần khoá
  // Zalo cá nhân (zca-js) tắt theo ràng buộc của dự án: không đăng ký adapter nên không gửi được qua kênh này
  if (ZALO_PERSONAL_ENABLED) registerAdapter(zaloPersonalAdapter);
  const zaloId = process.env.ZALO_APP_ID;
  const zaloSecret = process.env.ZALO_APP_SECRET;
  if (zaloId && zaloSecret) {
    registerAdapter(createZaloAdapter({ appId: zaloId, appSecret: zaloSecret, tokens: storeBackedTokens(store) }));
  }
}
