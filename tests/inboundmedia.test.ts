// Ảnh khách gửi qua Meta được tải về kho ảnh của KP Chat (đường dẫn CDN của Meta hết hạn).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { allowedMediaUrl, localizeMedia } from "../src/core/inboundmedia";
import { ingest } from "../src/core/ingest";
import { registerAdapter } from "../src/core/adapter";
import { mockAdapter } from "../src/adapters/mock";
import type { DB, Store } from "../src/core/store";

process.env.KPCHAT_MEDIA_DIR = mkdtempSync(path.join(tmpdir(), "kpimg-"));
registerAdapter(mockAdapter);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const mem = () => { const s = { db: { channels: { c: { id: "c", companyId: "x", kind: "facebook", externalId: "P", name: "P", sendEnabled: true } }, contacts: {}, conversations: {}, messages: {} } as DB, async load() { return structuredClone(s.db); }, async save(d: DB) { s.db = d; } }; return s as Store & { db: DB }; };

test("chỉ tải https từ máy chủ ảnh của Meta", () => {
  assert.equal(allowedMediaUrl("https://scontent.xx.fbcdn.net/v/t1.15752-9/a.png?x=1"), true);
  assert.equal(allowedMediaUrl("https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1"), true);
  assert.equal(allowedMediaUrl("http://scontent.xx.fbcdn.net/a.png"), false);
  assert.equal(allowedMediaUrl("https://fbcdn.net.evil.com/a.png"), false);
  assert.equal(allowedMediaUrl("https://169.254.169.254/latest"), false);
  assert.equal(allowedMediaUrl("https://localhost/a.png"), false);
});

test("ảnh khách gửi: nhận tin rồi tải về, đổi đường dẫn sang /api/media; chuyển hướng ra máy khác hoặc tệp không phải ảnh thì giữ nguyên", async () => {
  const s = mem();
  const good = "https://scontent.xx.fbcdn.net/good.png", redir = "https://scontent.xx.fbcdn.net/redir.png", html = "https://scontent.xx.fbcdn.net/x.html";
  const r = await ingest(s, "facebook", [{ channelExternalId: "P", contact: { externalId: "u1" }, message: { externalId: "m1", direction: "in", text: "", attachments: [{ type: "image", url: good }, { type: "image", url: redir }, { type: "image", url: html }], at: Date.now() } }]);
  assert.equal(r.newMedia.length, 3);
  const asked: string[] = [];
  const f = (async (u: string) => {
    asked.push(u);
    if (u === redir) return new Response(null, { status: 302, headers: { location: "https://169.254.169.254/x" } });
    if (u === html) return new Response("<html>", { status: 200 });
    return new Response(PNG, { status: 200 });
  }) as unknown as typeof fetch;
  assert.equal(await localizeMedia(s, r.newMedia, f), 1);
  const atts = s.db.messages["c:m1"].attachments;
  assert.match(atts[0].url, /^\/api\/media\/[0-9a-f]{32}\.png$/);
  assert.deepEqual(readFileSync(path.join(process.env.KPCHAT_MEDIA_DIR!, atts[0].url.split("/").pop()!)), PNG);
  assert.equal(atts[1].url, redir, "không theo chuyển hướng ra ngoài Meta");
  assert.equal(atts[2].url, html);
  assert.ok(!asked.some((u) => u.includes("169.254")));
});
