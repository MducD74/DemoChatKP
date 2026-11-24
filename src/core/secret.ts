// Mã hóa token kênh khi lưu (AES-256-GCM). Khóa lấy từ KPCHAT_SECRET_KEY, không ghi vào mã.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

function key(): Buffer {
  const k = process.env.KPCHAT_SECRET_KEY;
  if (!k) {
    if (process.env.NODE_ENV === "production") throw new Error("Thiếu KPCHAT_SECRET_KEY");
    // Chỉ để chạy thử local; production bắt buộc đặt khóa riêng.
    return createHash("sha256").update("kp-chat-local-dev-only").digest();
  }
  return createHash("sha256").update(k).digest();
}

export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function decryptJson<T>(blob: string): T {
  const [iv, tag, enc] = blob.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString("utf8")) as T;
}

// Chữ ký HMAC-SHA256 (hex) bằng khóa máy chủ, để ký mã phiên khách trên web mà không cần lưu gì trong kho.
export function signHmac(data: string): string {
  return createHmac("sha256", key()).update(data).digest("hex");
}
