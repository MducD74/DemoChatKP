import test from "node:test";
import assert from "node:assert/strict";
import { gate } from "../src/gate";

const KEY = "k".repeat(32);
const pub = { KPCHAT_PUBLIC_URL: "https://x.trycloudflare.com", KPCHAT_ACCESS_KEY: KEY };

test("chạy trên máy (không đặt địa chỉ công khai): không cần cổng", () => {
  assert.equal(gate({ pathname: "/api/channels", env: {} }).action, "allow");
});

test("công khai mà chưa có khóa truy cập hoặc khóa quá ngắn: chặn mọi thứ trừ webhook và ảnh", () => {
  const env = { KPCHAT_PUBLIC_URL: "https://x.trycloudflare.com" };
  assert.deepEqual(gate({ pathname: "/", env }).action, "deny");
  assert.deepEqual(gate({ pathname: "/api/inbox", env: { ...env, KPCHAT_ACCESS_KEY: "ngan" } }).action, "deny");
  assert.equal((gate({ pathname: "/", env }) as { status: number }).status, 503);
  assert.equal(gate({ pathname: "/api/webhook/facebook", env }).action, "allow");
  // Báo rõ thiếu hay quá ngắn (kể cả biến rỗng), không lộ giá trị khóa
  assert.match((gate({ pathname: "/", env: { ...env, KPCHAT_ACCESS_KEY: "" } }) as { message: string }).message, /không thấy biến môi trường KPCHAT_ACCESS_KEY/);
  const short = gate({ pathname: "/", env: { ...env, KPCHAT_ACCESS_KEY: "bimat123" } }) as { message: string };
  assert.match(short.message, /đọc được 8 ký tự, cần tối thiểu 16/);
  assert.ok(!short.message.includes("bimat123"));
  assert.equal(gate({ pathname: "/api/health", env }).action, "allow", "kiểm tra sống không cần khóa");
});

test("công khai: không có khóa thì 401; khóa đúng trong cookie thì vào; khóa trên địa chỉ thì đặt cookie rồi chuyển hướng; khóa sai bị chặn", () => {
  assert.equal((gate({ pathname: "/api/channels", env: pub }) as { status: number }).status, 401);
  assert.equal(gate({ pathname: "/api/channels", cookieKey: KEY, env: pub }).action, "allow");
  assert.equal(gate({ pathname: "/api/channels", cookieKey: "sai", env: pub }).action, "deny");
  const s = gate({ pathname: "/", queryKey: KEY, env: pub });
  assert.deepEqual(s, { action: "setcookie", key: KEY, redirect: "/" });
  assert.equal(gate({ pathname: "/", queryKey: KEY + "x", env: pub }).action, "deny");
});

test("ngoại lệ công khai: webhook từng kênh và ảnh mã ngẫu nhiên; các API khác vẫn bị chặn", () => {
  for (const p of ["/api/webhook/facebook", "/api/webhook/instagram", "/api/webhook/zalo_oa", "/api/webhook/tiktok", `/api/media/${"a".repeat(32)}.png`]) assert.equal(gate({ pathname: p, env: pub }).action, "allow", p);
  for (const p of ["/api/webhook/", "/api/webhook/a/b", "/api/media/abc.png", "/api/media", "/api/dev/seed", "/api/me", "/api/connect/meta/pages"]) assert.equal(gate({ pathname: p, env: pub }).action, "deny", p);
});
