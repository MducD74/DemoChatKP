// Địa chỉ quay về sau đăng nhập Facebook khi chạy sau proxy (Render): không được là localhost nội bộ.
import test from "node:test";
import assert from "node:assert/strict";
import { browserOrigin, loginBaseOf, publicBase } from "../src/core/origin";

const H = (h: Record<string, string>) => new Headers(h);

test("sau proxy Render: req.url là localhost nội bộ nhưng trình duyệt mở tên miền công khai thì quay về tên miền công khai", () => {
  const internal = "http://localhost:10000/api/connect/meta/start";
  const h = H({ host: "demochatkp.onrender.com", "x-forwarded-proto": "https" });
  assert.equal(loginBaseOf(h, internal, "https://demochatkp.onrender.com/"), "https://demochatkp.onrender.com");
  assert.equal(loginBaseOf(h, internal, undefined), "https://demochatkp.onrender.com", "chưa đặt KPCHAT_PUBLIC_URL vẫn đúng");
  assert.equal(loginBaseOf(H({ "x-forwarded-host": "kpchat.laban.asia", host: "10.0.0.5:10000", "x-forwarded-proto": "https" }), internal), "https://kpchat.laban.asia");
});

test("mở từ chính máy (localhost) thì quay về localhost dù có KPCHAT_PUBLIC_URL", () => {
  const u = "http://localhost:3031/api/connect/meta/start";
  assert.equal(loginBaseOf(H({ host: "localhost:3031" }), u, "https://x.trycloudflare.com"), "http://localhost:3031");
  assert.equal(browserOrigin(H({}), u).local, true);
});

test("địa chỉ công khai: ưu tiên KPCHAT_PUBLIC_URL", () => {
  assert.equal(publicBase(H({ host: "demochatkp.onrender.com" }), "http://localhost:10000/", "https://kpchat.laban.asia/"), "https://kpchat.laban.asia");
});
