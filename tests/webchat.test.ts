import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Ảnh tải lên trong test ghi vào thư mục tạm, không làm bẩn data/media của dự án
process.env.KPCHAT_MEDIA_DIR = mkdtempSync(join(tmpdir(), "kpweb-"));
import assert from "node:assert/strict";
import type { DB, Store } from "../src/core/store";
import { registerAdapter } from "../src/core/adapter";
import { webAdapter } from "../src/adapters/web";
import { allowedOrigin, createWebChannel, newSid, normOrigin, rateHit, updateWebChannel, validSid, webChannel, webCfg, webMessages, webSend, webUpload, webHandoff, WEB_LIMITS } from "../src/core/webchat";
import { readUpload, sniffImage } from "../src/core/media";
import { widgetScript } from "../src/core/webwidget";
import { gate } from "../src/gate";
import { sendReply } from "../src/core/service";
import { DEMO_STAFF } from "../src/core/staff";
import { runBot } from "../src/core/botauto";
import { setModelProvider } from "../src/core/botmodel";
import { saveBot, buildSystem } from "../src/core/chatbot";

registerAdapter(webAdapter);
const [ADMIN, LAN] = DEMO_STAFF;
const mem = () => {
  const s = { db: { channels: {}, contacts: {}, conversations: {}, messages: {} } as DB,
    async load() { return structuredClone(s.db); }, async save(d: DB) { s.db = d; } };
  return s as Store & { db: DB };
};
const mk = async (extra: Record<string, unknown> = {}) => {
  const s = mem();
  const r = await createWebChannel(s, { name: "Website XuXi", ...extra });
  assert.equal(r.ok, true, JSON.stringify(r));
  const ch = r.ok ? r.channel : (null as never);
  return { s, ch, key: ch.externalId };
};

test("tạo khung chat web: khóa công khai 32 ký tự, mặc định hợp lý, kiểm tra dữ liệu", async () => {
  const { ch, key } = await mk();
  assert.match(key, /^[a-f0-9]{32}$/);
  assert.equal(ch.kind, "web");
  assert.equal(ch.sendEnabled, true);
  assert.deepEqual(webCfg(ch), { title: "Chat với shop", greeting: "Xin chào! Mình có thể giúp gì cho bạn?", color: "#1E3A8A", origins: [], position: "right" });
  const s = mem();
  assert.equal((await createWebChannel(s, { name: "" })).ok, false);
  assert.equal((await createWebChannel(s, { name: "x", color: "đỏ" })).ok, false);
  assert.equal((await createWebChannel(s, { name: "x", origins: "không phải địa chỉ ::" })).ok, false);
  assert.equal((await createWebChannel(s, { name: "x", origins: "ftp://a.com" })).ok, false);
  const ok = await createWebChannel(s, { name: "x", origins: "xuxifruit.com\nhttps://Shop.LabanFood.com/trang?a=1, http://localhost:3000", position: "left", color: "#16A34A" });
  assert.equal(ok.ok, true);
  assert.deepEqual(webCfg(ok.ok ? ok.channel : (null as never)).origins, ["https://xuxifruit.com", "https://shop.labanfood.com", "http://localhost:3000"]);
  assert.equal(webCfg(ok.ok ? ok.channel : (null as never)).position, "left");
  assert.equal(normOrigin("javascript:alert(1)"), null);
});

test("sửa cấu hình khung chat; kênh khác loại không sửa được", async () => {
  const { s, ch } = await mk();
  const u = await updateWebChannel(s, ch.id, { title: "Trợ lý AI", greeting: "Chào bạn", origins: "https://a.com" });
  assert.equal(u.ok, true);
  assert.equal(webCfg(s.db.channels[ch.id]).title, "Trợ lý AI");
  assert.equal(s.db.channels[ch.id].externalId, ch.externalId, "khóa không đổi khi sửa");
  s.db.channels["fb"] = { id: "fb", companyId: "x", kind: "facebook", externalId: "P", name: "Fan", sendEnabled: true };
  assert.equal((await updateWebChannel(s, "fb", { name: "x" })).ok, false);
});

test("phiên khách: mã có chữ ký, khóa nào chỉ dùng được với khóa đó, giả mạo bị từ chối", async () => {
  const a = await mk(), b = await mk();
  const sid = newSid(a.key);
  assert.equal(validSid(a.key, sid), true);
  assert.equal(validSid(b.key, sid), false, "phiên của kênh khác không dùng được");
  const [r, sig] = sid.split(".");
  for (const bad of ["", "x", `${r}.`, `.${sig}`, `${r}.${sig}x`, `${r}.${sig}.extra`, `${r}x.${sig}`, `${"A".repeat(24)}.${sig}`, null, undefined, 123, "a".repeat(200)]) assert.equal(validSid(a.key, bad as never), false, String(bad));
  assert.notEqual(newSid(a.key), newSid(a.key));
});

test("tìm kênh theo khóa: sai định dạng, không tồn tại, đã tắt, kênh khác loại đều không thấy", async () => {
  const { s, ch, key } = await mk();
  assert.equal((await webChannel(s, key))?.id, ch.id);
  for (const k of ["", "abc", "G".repeat(32), null, undefined, 5, key.toUpperCase()]) assert.equal(await webChannel(s, k), null, String(k));
  s.db.channels[ch.id].off = true;
  assert.equal(await webChannel(s, key), null);
  s.db.channels[ch.id].off = false;
  s.db.channels["fb"] = { id: "fb", companyId: "x", kind: "facebook", externalId: "a".repeat(32), name: "Fan", sendEnabled: true };
  assert.equal(await webChannel(s, "a".repeat(32)), null);
});

test("website được phép (CORS): trống thì mọi website, có khai thì chỉ các website đó", async () => {
  const { ch } = await mk();
  assert.equal(allowedOrigin(ch, "https://bat-ky.com"), "*");
  const s = mem();
  const r = await createWebChannel(s, { name: "x", origins: "https://xuxifruit.com" });
  const c2 = r.ok ? r.channel : (null as never);
  assert.equal(allowedOrigin(c2, "https://xuxifruit.com"), "https://xuxifruit.com");
  assert.equal(allowedOrigin(c2, "https://ke-xau.com"), null);
  assert.equal(allowedOrigin(c2, "https://xuxifruit.com.ke-xau.com"), null);
  assert.equal(allowedOrigin(c2, "http://xuxifruit.com"), null, "khác giao thức");
  assert.equal(allowedOrigin(c2, null), "*");
});

test("khách nhắn: tin vào hộp thư thành hội thoại web, có tên mặc định; tin rỗng hoặc quá dài bị từ chối", async () => {
  const { s, ch, key } = await mk();
  const sid = newSid(key);
  const r = await webSend(s, ch, sid, { text: "  Cho mình hỏi giá  ", name: "" });
  assert.equal(r.ok, true);
  const conv = s.db.conversations[`${ch.id}:conv:${sid}`];
  assert.ok(conv);
  assert.equal(conv.lastInboundAt !== undefined, true);
  assert.equal(s.db.contacts[`${ch.id}:${sid}`].name, `Khách web ${sid.slice(0, 4)}`);
  assert.equal(Object.values(s.db.messages)[0].text, "Cho mình hỏi giá");
  assert.equal((await webSend(s, ch, sid, { text: "   " })).ok, false);
  const long = await webSend(s, ch, sid, { text: "x".repeat(WEB_LIMITS.text + 1) });
  assert.equal(long.ok, false);
  assert.equal(!long.ok && long.status, 400);
  // tên do khách nhập bị rút gọn và làm sạch khoảng trắng
  const sid2 = newSid(key);
  await webSend(s, ch, sid2, { text: "hi", name: "  Nguyễn    Văn   A" + "z".repeat(100) });
  assert.ok(s.db.contacts[`${ch.id}:${sid2}`].name.length <= WEB_LIMITS.visitorName);
});

test("ngôn ngữ khách (en, ko, zh, ru) được ghi vào hồ sơ và đưa vào lời nhắc để bot trả lời cùng ngôn ngữ; giá trị lạ bị bỏ", async () => {
  const { s, ch, key } = await mk();
  const sid = newSid(key);
  await webSend(s, ch, sid, { text: "How much?", lang: "EN" });
  assert.equal(s.db.contacts[`${ch.id}:${sid}`].lang, "en");
  const sid2 = newSid(key);
  await webSend(s, ch, sid2, { text: "hi", lang: "klingon" });
  assert.equal(s.db.contacts[`${ch.id}:${sid2}`].lang, undefined);
  s.db.bot = { settings: { docs: [] }, drafts: {}, bots: { b: { id: "b", name: "B", type: "new", channelIds: [ch.id], mode: "draft", tone: "", instructions: "", docIds: [], useTemplates: false, model: "claude-haiku-5-5", intro: "", at: 1 } } };
  const sys = buildSystem(s.db, s.db.bot.bots!.b, ch, "Khách", { lang: "ko" });
  assert.match(sys, /NGÔN NGỮ: khách đang dùng tiếng Hàn/);
  assert.doesNotMatch(buildSystem(s.db, s.db.bot.bots!.b, ch, "Khách", { lang: "vi" }), /NGÔN NGỮ/);
});

test("giới hạn tần suất: quá số tin trong 10 phút thì từ chối; hết cửa sổ thì cho lại", async () => {
  const { s, ch, key } = await mk();
  const sid = newSid(key);
  const t0 = Date.now();
  for (let i = 0; i < WEB_LIMITS.perSid10min; i++) assert.equal((await webSend(s, ch, sid, { text: `tin ${i}` }, "", t0 + i)).ok, true);
  const over = await webSend(s, ch, sid, { text: "thêm" }, "", t0 + 100);
  assert.equal(over.ok, false);
  assert.equal(!over.ok && over.status, 429);
  assert.equal((await webSend(s, ch, sid, { text: "sau 11 phút" }, "", t0 + 11 * 60_000)).ok, true);
  assert.equal(rateHit("b", 2, 1000, 0), true);
  assert.equal(rateHit("b", 2, 1000, 1), true);
  assert.equal(rateHit("b", 2, 1000, 2), false);
  assert.equal(rateHit("b", 2, 1000, 1500), true);
});

test("khách chỉ đọc được tin của phiên mình, không thấy ghi chú nội bộ; nhân viên và bot trả lời hiện đúng nhãn", async () => {
  const { s, ch, key } = await mk();
  const sid = newSid(key), other = newSid(key);
  await webSend(s, ch, sid, { text: "Cho mình hỏi giá", lang: "vi" }, "", Date.now() - 5000);
  await webSend(s, ch, other, { text: "Tin của người khác" }, "", Date.now() - 4000);
  // nhân viên trả lời qua hộp thư (sendReply đi qua adapter web)
  s.db.channels[ch.id].access = { lan: "send" };
  const rep = await sendReply(s, `${ch.id}:conv:${sid}`, { text: "Dạ giá 50.000đ ạ" }, LAN);
  assert.equal(rep.ok, true);
  // ghi chú nội bộ
  s.db.messages["note"] = { id: "note", companyId: "x", conversationId: `${ch.id}:conv:${sid}`, externalId: "n", direction: "out", text: "BÍ MẬT", attachments: [], at: Date.now(), internal: true, senderUid: "lan" };
  // tin của bot
  s.db.messages["botm"] = { id: "botm", companyId: "x", conversationId: `${ch.id}:conv:${sid}`, externalId: "b", direction: "out", text: "Dạ em là bot", attachments: [], at: Date.now() + 1, bot: true };
  const list = await webMessages(s, ch, sid);
  assert.deepEqual(list.map((m) => [m.from, m.text]), [["visitor", "Cho mình hỏi giá"], ["agent", "Dạ giá 50.000đ ạ"], ["bot", "Dạ em là bot"]]);
  assert.ok(!JSON.stringify(list).includes("BÍ MẬT"));
  assert.ok(!JSON.stringify(list).includes("người khác"));
  const after = list[1].at;
  assert.deepEqual((await webMessages(s, ch, sid, after)).map((m) => m.from), ["bot"]);
});

test("chatbot tự trả lời cho khách web: tin của bot hiện cho khách, theo luật như các kênh khác", { skip: "Tự trả lời đã tắt theo ràng buộc dự án: chatbot không tự gửi (src/core/guardrails.ts)" }, async () => {
  const { s, ch, key } = await mk();
  s.db.channels[ch.id].access = { lan: "send" };
  const saved = await saveBot(s, { name: "Bot web", type: "new", channelIds: [ch.id], mode: "auto", intro: "" });
  assert.equal(saved.ok, true);
  setModelProvider({ id: "fake", async complete() { return { ok: true, text: "Dạ giá từ 50.000đ ạ." }; } });
  const sid = newSid(key);
  await webSend(s, ch, sid, { text: "Giá cam bao nhiêu?" }, "", Date.now() - 3000);
  const r = await runBot(s, `${ch.id}:conv:${sid}`);
  assert.equal(r.ok, true);
  const list = await webMessages(s, ch, sid);
  assert.deepEqual(list.map((m) => [m.from, m.text]), [["visitor", "Giá cam bao nhiêu?"], ["bot", "Dạ giá từ 50.000đ ạ."]]);
  setModelProvider(undefined);
});

test("script nhúng: cú pháp hợp lệ, chứa khóa và địa chỉ, đọc KPS_CHAT, không chèn HTML, không đụng cookie", () => {
  const key = "a1b2c3d4".repeat(4);
  const js = widgetScript("https://chat.example.com/", key);
  assert.doesNotThrow(() => new Function(js), "script phải là JavaScript hợp lệ");
  assert.match(js, /BASE="https:\/\/chat\.example\.com"/, "bỏ dấu / cuối địa chỉ");
  assert.ok(js.includes(`KEY="${key}"`));
  assert.match(js, /window\.KPS_CHAT/);
  for (const l of ["vi", "en", "ko", "zh", "ru"]) assert.ok(js.includes(`${l}:{ph:`), l);
  assert.doesNotMatch(js, /document\.cookie/);
  assert.doesNotMatch(js, /innerHTML\s*=\s*(?!'<svg)/, "chỉ innerHTML cho biểu tượng cố định");
  assert.ok(js.length < 6000 * 3, "gọn");
  // địa chỉ có ký tự lạ không phá được chuỗi
  assert.doesNotThrow(() => new Function(widgetScript('https://a.com/"</script><script>alert(1)//', key)));
});

test("cổng bảo vệ: các API công khai của khung chat mở được khi KP Chat ra Internet, API quản trị vẫn khóa", () => {
  const pub = { KPCHAT_PUBLIC_URL: "https://x.trycloudflare.com", KPCHAT_ACCESS_KEY: "k".repeat(20) };
  for (const p of ["/api/web/widget.js", "/api/web/session", "/api/web/messages", "/api/web/send", "/api/web/upload", `/api/media/${"a".repeat(32)}.webp`]) assert.equal(gate({ pathname: p, env: pub }).action, "allow", p);
  for (const p of ["/api/web/", "/api/web/other", "/api/web/send/x", "/api/bot/webchat", "/api/bot", "/api/inbox"]) assert.equal(gate({ pathname: p, env: pub }).action, "deny", p);
});

// ---------- Khách gửi ảnh ----------
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1]);
const WEBP = new Uint8Array([...Buffer.from("RIFF"), 4, 0, 0, 0, ...Buffer.from("WEBPVP8 ")]);

test("nhận dạng ảnh theo nội dung thật: jpg, png, webp; gif, svg, html và tệp rỗng bị loại", () => {
  assert.equal(sniffImage(PNG), "png");
  assert.equal(sniffImage(JPG), "jpg");
  assert.equal(sniffImage(WEBP), "webp");
  assert.equal(sniffImage(new Uint8Array(Buffer.from("GIF89a......"))), null);
  assert.equal(sniffImage(new Uint8Array(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"))), null);
  assert.equal(sniffImage(new Uint8Array(Buffer.from("<html><script>alert(1)</script></html>"))), null);
  assert.equal(sniffImage(new Uint8Array([])), null);
});

test("khách tải ảnh lên rồi gửi kèm tin: ảnh vào hội thoại, nhân viên thấy ảnh, khách thấy lại khi tải tin", async () => {
  const { s, ch } = await mk();
  const sid = newSid(ch.externalId);
  const up = await webUpload(sid, PNG, "https://kp.example/", "1.1.1.1");
  assert.equal(up.ok, true, JSON.stringify(up));
  const url = up.ok ? up.url : "";
  assert.match(url, /^https:\/\/kp\.example\/api\/media\/[0-9a-f]{32}\.png$/);
  assert.ok(await readUpload(url.split("/").pop() as string), "tệp đã lưu và đọc lại được");
  // chỉ ảnh, không chữ
  const r = await webSend(s, ch, sid, { images: [url] }, "1.1.1.1", Date.now(), "https://kp.example");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.ok ? r.message.images : [], [url]);
  const db = await s.load();
  const m = Object.values(db.messages).find((x) => x.attachments.length);
  assert.deepEqual(m?.attachments, [{ type: "image", url }]);
  assert.equal(m?.text, "");
  const list = await webMessages(s, ch, sid);
  assert.deepEqual(list.at(-1)?.images, [url]);
  // chữ kèm ảnh
  assert.equal((await webSend(s, ch, sid, { text: "cái này ạ", images: [url] }, "", Date.now(), "https://kp.example")).ok, true);
});

test("ảnh khách: chỉ nhận ảnh đã tải lên KP Chat; địa chỉ ngoài, mã giả, quá 3 ảnh, tệp sai loại hoặc quá 5MB đều bị từ chối", async () => {
  const { s, ch } = await mk();
  const sid = newSid(ch.externalId);
  const bad = (images: unknown) => webSend(s, ch, sid, { text: "x", images }, "", Date.now(), "https://kp.example");
  for (const images of [["https://evil.example/a.png"], ["https://kp.example/api/media/" + "a".repeat(32) + ".png"], ["https://kp.example/api/media/../../chat.json"], "https://x/y.png", [123], [{ url: "x" }]]) {
    const r = await bad(images);
    assert.equal(r.ok, false, JSON.stringify(images));
  }
  const ok = await webUpload(sid, JPG, "https://kp.example");
  const u = ok.ok ? ok.url : "";
  assert.equal((await bad([u, u, u, u])).ok, false, "tối đa 3 ảnh");
  assert.equal(Object.keys((await s.load()).messages).length, 0, "không có tin nào lọt vào kho");
  // địa chỉ khách gửi được dựng lại theo máy chủ, không giữ nguyên tên miền khách khai
  const r = await webSend(s, ch, sid, { images: [u.replace("https://kp.example", "https://khac.example") + "?x=1"] }, "", Date.now(), "https://kp.example");
  assert.deepEqual(r.ok ? r.message.images : [], [u]);
  // tệp sai loại / lớn / rỗng
  assert.equal((await webUpload(sid, new Uint8Array(Buffer.from("GIF89a..........")), "https://kp.example")).ok, false);
  assert.equal((await webUpload(sid, new Uint8Array(Buffer.from("<svg onload=alert(1)>")), "https://kp.example")).ok, false);
  assert.equal((await webUpload(sid, new Uint8Array(0), "https://kp.example")).ok, false);
  const big = new Uint8Array(5 * 1024 * 1024 + 1); big.set(PNG);
  assert.equal((await webUpload(sid, big, "https://kp.example")).ok, false);
  // tin rỗng (không chữ, không ảnh) vẫn bị từ chối
  assert.equal((await webSend(s, ch, sid, { text: " ", images: [] }, "", Date.now(), "https://kp.example")).ok, false);
});

test("tải ảnh lên bị giới hạn tần suất theo phiên và theo địa chỉ IP", async () => {
  const { ch } = await mk();
  const sid = newSid(ch.externalId);
  const t = Date.now();
  for (let i = 0; i < WEB_LIMITS.uploadsPerSid10min; i++) assert.equal((await webUpload(sid, PNG, "https://kp.example", "", t)).ok, true, `lần ${i + 1}`);
  const r = await webUpload(sid, PNG, "https://kp.example", "", t);
  assert.equal(r.ok, false);
  assert.equal(r.ok ? 0 : r.status, 429);
  assert.equal((await webUpload(newSid(ch.externalId), PNG, "https://kp.example", "", t + 600_001)).ok, true, "phiên khác không bị ảnh hưởng");
});

test("script nhúng có nút đính kèm (class riêng .katt, không dùng .kemo), xem trước ảnh, cỡ chữ ô nhập 16px, dùng dvh, giữ nguyên cấu trúc cũ", () => {
  const js = widgetScript("https://chat.example.com", "a".repeat(32));
  assert.doesNotThrow(() => new Function(js));
  assert.match(js, /className="katt"/);
  assert.doesNotMatch(js, /kemo|kepop/);
  assert.match(js, /image\/jpeg,image\/png,image\/webp/);
  assert.doesNotMatch(js, /capture/, "không ép chụp ảnh: điện thoại cho chọn cả máy ảnh lẫn thư viện");
  assert.match(js, /\/api\/web\/upload/);
  assert.match(js, /font-size:16px;outline:none/);
  assert.match(js, /100dvh/);
  for (const l of ["vi", "en", "ko", "zh", "ru"]) assert.match(js.slice(js.indexOf(`${l}:{ph:`)), /att:"[^"]+",ho:"[^"]+",rm:"[^"]+",big:"[^"]+",typ:"[^"]+"/, l);
  // cấu trúc DOM KP Shop dựa vào
  for (const sel of [".fab", ".panel", ".badge", "z-index:2147483000", 'sb.type="submit"', 'document.createElement("form")', 'document.createElement("input")']) assert.ok(js.includes(sel), sel);
  assert.ok(js.indexOf("form.appendChild(inp);form.appendChild(at);form.appendChild(sb)") > 0, "thứ tự trong form: ô nhập, nút ảnh, nút gửi");
});

test("khách chờ nhân viên: sau khi bot chuyển người thì khung chat báo, nhân viên trả lời thì hết báo; phiên khác không bị ảnh hưởng", async () => {
  const { s, ch } = await mk();
  const sid = newSid(ch.externalId), other = newSid(ch.externalId);
  assert.equal(await webHandoff(s, ch, sid), false);
  const t = Date.now();
  await webSend(s, ch, sid, { text: "Cho mình khiếu nại" }, "", t);
  const db = await s.load();
  const convId = `${ch.id}:conv:${sid}`;
  db.bot = { settings: { docs: [] }, bots: {}, drafts: { d1: { id: "d1", conversationId: convId, channelId: ch.id, forInboundAt: t, kind: "handoff", text: "", reason: "Khiếu nại", status: "handed", shadow: false, at: t + 1000 } } } as never;
  await s.save(db);
  assert.equal(await webHandoff(s, ch, sid, t + 2000), true);
  assert.equal(await webHandoff(s, ch, other, t + 2000), false);
  const db2 = await s.load();
  db2.messages["staff1"] = { id: "staff1", companyId: "default", conversationId: convId, externalId: "staff1", direction: "out", text: "Dạ em xin lỗi", attachments: [], at: t + 5000, senderUid: "u-lan" };
  await s.save(db2);
  assert.equal(await webHandoff(s, ch, sid, t + 6000), false, "có người trả lời thì thôi báo");
});

test("script nhúng: có dòng báo chờ nhân viên (5 ngôn ngữ) và đọc handoff từ máy chủ", () => {
  const js = widgetScript("https://chat.example.com", "a".repeat(32));
  assert.doesNotThrow(() => new Function(js));
  assert.match(js, /r\.handoff/);
  assert.equal((js.match(/,ho:"/g) ?? []).length, 5);
});
