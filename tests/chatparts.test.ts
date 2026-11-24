import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { attName, attSrc, AttachmentView, isMedia, Linkify, linksIn } from "../src/components/ChatParts";
import SidePanel, { BuysTab, botOptions } from "../src/components/SidePanel";
import type { BotAssignLite } from "../src/components/BotMenu";
import { DEMO_STAFF } from "../src/core/staff";
import type { Contact, Conversation } from "../src/core/types";
import QuickPanel from "../src/components/QuickPanel";
import BotMenu, { botPill } from "../src/components/BotMenu";
import { BOT_STATES, BOT_STATE_LABEL, statusToState } from "../src/core/botfilter";
import { MediaBrowser, QuickLibrary } from "../src/components/LibraryPane";
import type { Template } from "../src/core/store";
import type { HostProfile } from "../src/core/hostprofile";

const html = (text: string) => renderToStaticMarkup(createElement(Linkify, { text }));

test("liên kết trong tin: chỉ http và https, mở tab mới kèm noopener, dấu câu cuối không dính vào liên kết, chữ khác được thoát an toàn", () => {
  assert.equal(html("xem https://vt.tiktok.com/ZSsd/, nhé"), 'xem <span><a href="https://vt.tiktok.com/ZSsd/" target="_blank" rel="noopener noreferrer">https://vt.tiktok.com/ZSsd/</a>,</span> nhé');
  assert.doesNotMatch(html("javascript:alert(1) và data:text/html,<script>"), /<a /);
  assert.match(html("<img src=x onerror=alert(1)>"), /&lt;img/);
  assert.equal(html("không có liên kết"), "không có liên kết");
  assert.match(html('http://a.com/"><script>alert(1)</script>'), /<a href="http:\/\/a\.com\/"/);
  assert.doesNotMatch(html('http://a.com/"><script>alert(1)</script>'), /<script>/);
});

test("gom liên kết trong tin để hiện ở mục Liên kết bên phải", () => {
  assert.deepEqual(linksIn("a https://x.com/1. b http://y.vn/2) c"), ["https://x.com/1", "http://y.vn/2"]);
  assert.deepEqual(linksIn("không có"), []);
});

test("tệp đính kèm: ảnh và video xếp vào Ảnh/Video, còn lại là Tệp; tên lấy từ địa chỉ khi thiếu; ảnh TikTok đi qua máy chủ", () => {
  assert.equal(isMedia({ type: "image", url: "u" }), true);
  assert.equal(isMedia({ type: "sticker", url: "u" }), true);
  assert.equal(isMedia({ type: "video", url: "u" }), true);
  assert.equal(isMedia({ type: "file", url: "u" }), false);
  assert.equal(attName({ type: "file", url: "https://x.com/a/B%C3%A1o%20gi%C3%A1.pdf?x=1" }), "Báo giá.pdf");
  assert.equal(attName({ type: "file", url: "https://x.com/a.pdf", name: "Bảng giá.pdf" }), "Bảng giá.pdf");
  assert.equal(attSrc({ type: "image", url: "https://x.com/a.png" }, "c1"), "https://x.com/a.png");
  assert.equal(attSrc({ type: "image", url: "tiktok-media://abc" }, "c 1"), "/api/inbox/media?channel=c%201&ref=tiktok-media%3A%2F%2Fabc");
});

test("bong bóng tin: tệp hiện thẻ có biểu tượng và tên, ảnh bấm được, âm thanh có trình phát", () => {
  const r = (a: Parameters<typeof AttachmentView>[0]["a"]) => renderToStaticMarkup(createElement(AttachmentView, { a, channelId: "c" }));
  const f = r({ type: "file", url: "https://x.com/bg.pdf", name: "Bảng giá.pdf" });
  assert.match(f, /class="kc-file"/);
  assert.match(f, /Bảng giá\.pdf/);
  assert.match(f, /rel="noopener noreferrer"/);
  assert.match(r({ type: "image", url: "https://x.com/a.png" }), /<img[^>]+class="pic"/);
  assert.match(r({ type: "audio", url: "https://x.com/a.mp3" }), /<audio/);
});

test("tab Đơn hàng chỉ liệt kê lịch sử đơn từ POS (không có nút tạo đơn): báo đúng lý do khi chưa nối POS hoặc chưa khớp khách KiotViet", () => {
  const r = (p: HostProfile) => renderToStaticMarkup(createElement(BuysTab, { profile: p }));
  assert.match(r({ linked: { crm: false, pos: false } }), /Chưa nối POS/);
  assert.match(r({ linked: { crm: true, pos: true } }), /Chưa khớp khách KiotViet/);
  assert.match(r({ linked: { crm: true, pos: true }, kov: { id: "1", code: "KH1", name: "A" }, buys: { invoices: [], mix: [] } }), /Chưa có đơn hàng/);
  const html = r({ linked: { crm: true, pos: true }, kov: { id: "1", code: "KH1", name: "A" }, buys: { invoices: [{ code: "HD1", at: "2026-11-20", total: 199000 }, { code: "HD2", at: "2026-11-22", total: 50000 }], mix: [{ name: "Hộp quà", pct: 80 }] } });
  assert.match(html, /2 hóa đơn · tổng 249\.000đ/);
  assert.match(html, /20\/11/);
  assert.match(html, /HD2/);
  assert.match(html, /Hay mua: Hộp quà 80%/);
  assert.doesNotMatch(html, /<button/, "chỉ xem, không tạo đơn");
});

test("bảng Mẫu trả lời theo KP Chat 1: ký tự tắt, nội dung, số nội dung, ảnh nhỏ kèm số ảnh còn lại; quản trị có nút sửa, nhân viên thì không", () => {
  const lib = { folders: [], items: [{ id: "i1", file: "i1.png", name: "A", size: 1, at: 1, url: "https://x/a.png" }, { id: "i2", file: "i2.png", name: "B", size: 1, at: 1, url: "https://x/b.png" }] };
  const T: Template[] = [
    { id: "t1", key: "menu", order: 1, blocks: [{ text: "Menu hôm nay", images: ["i1", "i2"] }, { text: "Giá đã gồm VAT", images: [] }] },
    { id: "t2", key: "anh", order: 2, blocks: [{ text: "", images: ["i2"] }] },
  ];
  const r = (admin: boolean, templates = T) => renderToStaticMarkup(createElement(QuickPanel, { templates, lib, admin, onUse: () => {}, onClose: () => {}, onEdit: () => {} }));
  const html = r(true);
  assert.match(html, /\/menu/);
  assert.match(html, /Menu hôm nay · Giá đã gồm VAT/);
  assert.match(html, /2 nội dung/);
  assert.match(html, /<img src="https:\/\/x\/a\.png"/);
  assert.match(html, /\+1/);
  assert.match(html, /\(chỉ có ảnh\)/);
  assert.match(html, /aria-label="Sửa mẫu trả lời"/);
  assert.doesNotMatch(r(false), /Sửa mẫu trả lời/);
  assert.match(r(true, []), /Chưa có mẫu\. Bấm biểu tượng bút/);
  assert.match(r(false, []), /Nhờ quản trị thêm mẫu/);
});

test("khung xem ảnh lớn không dùng tên lớp CSS của khung Thư mục ảnh (kc-lb): trước đây trùng tên làm vỡ Thư mục ảnh và Thư viện mẫu", () => {
  const css = readFileSync(new URL("../src/components/pages/chat.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.kc-lb\{[^}]*position:fixed/, "kc-lb là khung thư mục ảnh, không được phủ kín màn hình");
  assert.match(css, /\.kc-lbx\{position:fixed/);
  const html = renderToStaticMarkup(createElement(AttachmentView, { a: { type: "image", url: "https://x/a.png" }, channelId: "c" }));
  assert.doesNotMatch(html, /class="kc-lb"/);
});

const LIB = { folders: ["Giỏ trái cây", "Hộp trái cây"], items: [
  { id: "a", file: "a.png", name: "4.1", folder: "Giỏ trái cây", size: 1, at: 3, url: "https://x/a.png" },
  { id: "b", file: "b.png", name: "4.2", folder: "Hộp trái cây", size: 1, at: 2, url: "https://x/b.png" },
  { id: "c", file: "c.png", name: "xh003", size: 1, at: 1, url: "https://x/c.png" },
] };
const noop = async () => {};

test("Thư mục ảnh sao từ KP Chat 1: cột thư mục có số ảnh, Tải lên gần đây, tìm ảnh, lưới ảnh có tên; quản trị có nút thêm thư mục và tải ảnh", () => {
  const html = renderToStaticMarkup(createElement(MediaBrowser, { lib: LIB, reload: noop, admin: true }));
  for (const s of ["Tất cả ảnh", "Tải lên gần đây", "Giỏ trái cây", "Hộp trái cây", "Tìm thư mục", "Tìm ảnh bằng tên", "Thêm thư mục", "Tải ảnh lên", "3 ảnh"]) assert.ok(html.includes(s), s);
  assert.match(html, /<em>3<\/em>/, "Tất cả ảnh có 3 ảnh");
  assert.match(html, /Tải ảnh lên · Giỏ trái cây/, "đang ở Tất cả ảnh thì ảnh tải lên vào thư mục đầu tiên và nút ghi rõ tên");
  assert.match(renderToStaticMarkup(createElement(MediaBrowser, { lib: { folders: [], items: [] }, reload: noop, admin: true })), /Tải ảnh lên<\/button>/, "chưa có thư mục thì không ghi tên");
  for (const n of ["4.1", "4.2", "xh003"]) assert.ok(html.includes(n), n);
  const staff = renderToStaticMarkup(createElement(MediaBrowser, { lib: LIB, reload: noop, admin: false }));
  assert.doesNotMatch(staff, /Thêm thư mục|Tải ảnh lên/);
  assert.doesNotMatch(staff, /Xóa ảnh|Đổi tên ảnh/);
});

test("hộp chọn ảnh khi soạn tin: tải ảnh từ máy, Bấm ảnh để chọn (tối đa 10), Gửi ngay và nút Chọn ở chân hộp", () => {
  const html = renderToStaticMarkup(createElement(MediaBrowser, { lib: LIB, reload: noop, admin: false, pick: { max: 10, initial: ["a", "b"], label: "Chọn", onDone: () => {}, onLocal: () => {}, onSendNow: () => {} } }));
  assert.match(html, /Tải ảnh từ máy/);
  assert.match(html, /Đã chọn 2\/10 ảnh/);
  assert.match(html, /Gửi ngay \(2\)/);
  assert.match(html, /Chọn \(2\)/);
  const none = renderToStaticMarkup(createElement(MediaBrowser, { lib: LIB, reload: noop, admin: false, pick: { max: 10, initial: [], label: "Chọn", onDone: () => {}, onSendNow: () => {} } }));
  assert.match(none, /Bấm ảnh để chọn \(tối đa 10\)/);
  assert.match(none, /<button class="btn" disabled="">/, "chưa chọn ảnh thì Gửi ngay bị khóa");
});

test("Mẫu trả lời sao từ KP Chat 1: bảng STT, ký tự tắt, tin nhắn kèm ảnh nhỏ; quản trị có Xuất, Nhập, Thêm mẫu và nút lên xuống sửa xóa", () => {
  const T: Template[] = [{ id: "t1", key: "menu", order: 1, blocks: [{ text: "Menu hôm nay", images: ["a", "b"] }, { text: "VAT", images: [] }] }];
  const r = (admin: boolean) => renderToStaticMarkup(createElement(QuickLibrary, { quick: T, lib: LIB, admin, reload: noop, reloadLib: noop }));
  const a = r(true);
  for (const s of ["STT", "Ký tự tắt", "Tin nhắn", "/menu", "Menu hôm nay · VAT", "2 nội dung", "Xuất", "Nhập", "Thêm mẫu", "Sửa mẫu", "Xóa mẫu"]) assert.ok(a.includes(s), s);
  assert.match(a, /<img src="https:\/\/x\/a\.png"/);
  assert.match(a, /\+1/);
  assert.match(a, /\{ten_khach\} \{ten_nhan_vien\}/);
  assert.doesNotMatch(r(false), /Thêm mẫu|Xóa mẫu|Xuất/);
});

test("hộp thả nhãn trong bộ lọc không dính luật xếp dọc và chữ hoa của ô lọc; thứ tự ô lọc là Thời gian, Phụ trách, Giai đoạn CRM, Nhãn, Chatbot", () => {
  const css = readFileSync(new URL("../src/components/pages/chat.css", import.meta.url), "utf8");
  assert.match(css, /\.kc-fg \.kc-lp-i,\.kc-fg \.kc-lp-f label\{flex-direction:row/);
  assert.match(css, /\.kc-fg \.kc-lp-i span[^{]*\{[^}]*text-transform:none/);
  const src = readFileSync(new URL("../src/components/ChatPane.tsx", import.meta.url), "utf8");
  const at = (s: string) => src.indexOf(s, src.indexOf('<div className="kc-fg">'));
  const order = ["<span>Thời gian</span>", "<span>Phụ trách</span>", "<span>Giai đoạn CRM</span>", '<span className="kc-fl2h">Nhãn</span>'].map(at);
  assert.ok(order.every((x) => x > 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "đúng thứ tự");
});

test("giai đoạn CRM không còn ở đầu khung chat mà đổi ngay ở dòng Lead CRM của cột 3; chọn Mất/Spam thì hỏi lý do", () => {
  const src = readFileSync(new URL("../src/components/ChatPane.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /Giai đoạn CRM<Select/, "đầu khung chat không còn ô Giai đoạn CRM");
  assert.doesNotMatch(src, /kc-mv/, "thanh hỏi lý do mất đơn cũng không còn ở đầu khung chat");
  const conv = { id: "v", companyId: "x", channelId: "c", contactId: "k", status: "open", labels: [], stage: "near" } as Conversation;
  const contact = { id: "k", companyId: "x", channelId: "c", externalId: "k", name: "Khách A" } as Contact;
  const props = { conv, contact, messages: [], kind: "Messenger", channelName: "Page", me: { uid: "u1" }, staff: DEMO_STAFF, admin: true, canAct: true, avatar: null, onPatch: () => {}, onChanged: () => {} };
  const html = renderToStaticMarkup(createElement(SidePanel, { ...props, profile: { linked: { crm: false, pos: false }, lead: { id: "v", stage: "near", stageName: "Gần chốt", core: "near" } } }));
  assert.match(html, /Lead CRM/);
  assert.match(html, /<option value="near" selected="">Gần chốt<\/option>/, "dòng Lead CRM là ô chọn, đang ở Gần chốt");
  for (const o of ["Mới", "Quan tâm", "Tiềm năng", "Chuyển đổi", "Mất/Spam", "Bỏ lead"]) assert.ok(html.includes(`>${o}</option>`), o);
  assert.doesNotMatch(html, /Lý do:/, "chưa chọn Mất/Spam thì chưa hỏi lý do");
  const none = renderToStaticMarkup(createElement(SidePanel, { ...props, conv: { ...conv, stage: undefined } as Conversation, profile: { linked: { crm: false, pos: false } } }));
  assert.match(none, /\+ Tạo lead/, "chưa có lead thì có nút Tạo lead");
  const lost = renderToStaticMarkup(createElement(SidePanel, { ...props, conv: { ...conv, stage: "lost", lostReason: "Giá chưa phù hợp" } as Conversation, profile: { linked: { crm: false, pos: false }, lead: { id: "v", stage: "lost", stageName: "Mất/Spam", core: "lost" } } }));
  assert.match(lost, /Lý do mất<\/span><b>Giá chưa phù hợp/);
});

test("không còn ô Tình trạng (Đang mở/Hoãn); bộ lọc Trạng thái gọn (yêu cầu 3.1): đã xong ẩn mặc định, tìm kiếm thì vẫn thấy", () => {
  const src = readFileSync(new URL("../src/components/ChatPane.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /<span>Tình trạng<\/span>/);
  assert.doesNotMatch(src, /"Đang mở"|"Hoãn"/);
  assert.match(src, /\["open", "Đang xử lý"\], \["resolved", "Đã xong"\], \["all", "Tất cả"\]/);
  assert.match(src, /useState\("open"\)/, "mặc định: đang xử lý (ẩn hội thoại đã xong)");
  assert.match(src, /const st = qq \? "all" : fStatus === "open" \? "active" : fStatus;/, "khi tìm kiếm thì thấy cả hội thoại đã xong");
  const side = readFileSync(new URL("../src/components/SidePanel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(side, /<span>Hội thoại<\/span>|"Hoãn"|"Đang mở"/);
});

test("nút Bot nhỏ ở đầu khung chat thay hàng trạng thái và hàng Gợi ý: nhãn theo trạng thái, menu có Tiếp quản, Giao lại, Nhờ bot gợi ý; chỉ hiện đổi chatbot khi có từ hai bot", () => {
  const base = { busy: false, assign: null, hasAssignee: false, onTake: () => {}, onBack: () => {}, onAsk: () => {}, onAssign: () => {} };
  const r = (p: Partial<Parameters<typeof BotMenu>[0]>, open = false) => renderToStaticMarkup(createElement(BotMenu, { ...base, canAsk: false, ...p, defaultOpen: open } as Parameters<typeof BotMenu>[0]));
  assert.equal(r({ canAsk: false }), "", "không có bot và không có gì để làm thì không hiện nút");
  for (const kind of ["bot", "draft", "paused", "handoff"] as const) assert.match(r({ status: { kind, text: "x" } }), new RegExp(`Chatbot · ${BOT_STATE_LABEL[statusToState(kind)]}<`), kind);
  assert.match(r({ canAsk: true }), />Chatbot</, "chưa có trạng thái nhưng nhờ gợi ý được thì hiện nút Chatbot");
  const open = r({ status: { kind: "bot", text: "Xuxi đang trả lời", canTake: true }, canAsk: true }, true);
  assert.doesNotMatch(open, />Xuxi đang trả lời</, "menu không có đoạn giải thích trạng thái, lý do nằm ở gợi ý khi rê chuột");
  assert.match(open, /title="Xuxi đang trả lời"/);
  assert.doesNotMatch(open, /<small>/, "không có dòng phụ dưới các nút");
  assert.match(open, /Tiếp quản/);
  assert.match(open, />Nhờ chatbot gợi ý</);
  assert.doesNotMatch(open, /Giao lại cho chatbot|Chatbot của hội thoại này/);
  const handoff = r({ status: { kind: "handoff", text: "Bot chuyển người", canTake: true } }, true);
  assert.match(handoff, />Nhận khách</, "bot chuyển người thì nút là Nhận khách");
  assert.match(r({ status: { kind: "paused", text: "Lan phụ trách", canBack: true } }, true), /Giao lại cho chatbot/);
  assert.doesNotMatch(r({ status: { kind: "bot", text: "x" } }, true), /Chatbot của hội thoại này|Không dùng chatbot/, "menu chỉ có thao tác nhanh; gán chatbot ở cột hồ sơ");
  const src = readFileSync(new URL("../src/components/ChatPane.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /kc-hand|kc-bot-ask/, "không còn hàng trạng thái và hàng Gợi ý tin nhắn");
  assert.match(src, /filter\(\(l\) => l !== HANDOFF_LABEL\)/, "nhãn Bot: cần người ẩn khỏi danh sách");
});

test("popup Lọc có hai ô chatbot sau Nhãn: Trợ lý AI (kèm loại chốt sale hoặc chăm sóc) rồi Trạng thái chatbot; ô Chatbot cũ đã bỏ", () => {
  const src = readFileSync(new URL("../src/components/ChatPane.tsx", import.meta.url), "utf8");
  const from = src.indexOf('<div className="kc-fg">');
  const at = (s: string) => src.indexOf(s, from);
  const order = ['<span className="kc-fl2h">Nhãn</span>', "<span>KP AIbot</span>", "<span>Trạng thái chatbot</span>", "Có số điện thoại"].map(at);
  assert.ok(order.every((x) => x > 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.doesNotMatch(src, /<span>Chatbot<\/span>/);
  assert.match(src, /ASSISTANT_KIND\[b\.type\]/, "mỗi trợ lý ghi loại chốt sale hoặc chăm sóc");
});

test("cột hồ sơ có chỗ gán KP AIbot cho hội thoại và hiện trạng thái chatbot: chọn Theo giai đoạn khách, từng chatbot, Không dùng; công tắc cùng trả lời khi có nhân viên", () => {
  const conv = { id: "v", companyId: "x", channelId: "c", contactId: "k", status: "open", labels: [] } as Conversation;
  const contact = { id: "k", companyId: "x", channelId: "c", externalId: "k", name: "Khách A" } as Contact;
  const base = { conv, contact, messages: [], kind: "Messenger", channelName: "Page", me: { uid: "u1" }, staff: DEMO_STAFF, admin: true, canAct: true, avatar: null, onPatch: () => {}, onChanged: () => {}, profile: { linked: { crm: false, pos: false } } };
  const assign: BotAssignLite = { options: [{ id: "b1", name: "Xuxi Chatbot", mode: "auto" }, { id: "b2", name: "Chatbot chăm sóc", mode: "off" }], sel: "", withStaff: false, picked: { id: "b1", name: "Xuxi Chatbot", mode: "auto" } };
  const r = (extra: object) => renderToStaticMarkup(createElement(SidePanel, { ...base, ...extra } as Parameters<typeof SidePanel>[0]));
  const html = r({ botAssign: assign, botStatus: { kind: "bot", text: "Xuxi Chatbot đang trả lời" } });
  assert.match(html, /<span>KP AIbot<\/span>/);
  assert.match(html, /<option value="" selected="">Tự động: Xuxi Chatbot<\/option>/);
  assert.doesNotMatch(html, /<option value="b1">/, "chatbot đang được chọn tự động không lặp lại trong danh sách");
  assert.match(html, /<option value="b2">Chatbot chăm sóc \(tắt\)<\/option>/);
  assert.match(html, /<option value="none">Không dùng chatbot<\/option>/);
  assert.match(html, /<span>Trạng thái<\/span><b class="kc-bst bot" title="[^"]*"><i aria-hidden="true"><\/i>Đang phụ trách<\/b>/);
  assert.match(html, /title="Xuxi Chatbot đang trả lời"/, "lý do chỉ hiện khi rê chuột");
  assert.doesNotMatch(html, />Xuxi Chatbot đang trả lời</, "không còn dòng giải thích dưới Trạng thái");
  assert.doesNotMatch(html, /Cùng trả lời với nhân viên/, "chưa có nhân viên phụ trách thì chưa cần công tắc");
  const staffed = r({ conv: { ...conv, assigneeUid: "u2" }, botAssign: assign, botStatus: { kind: "paused", text: "Lan đang phụ trách, chatbot không trả lời" } });
  assert.match(staffed, /Cùng trả lời với nhân viên/);
  assert.match(staffed, />Tạm dừng</, "nhường người cũng là Tạm dừng");
  assert.doesNotMatch(staffed, /Nhường người/);
  const off = r({ conv: { ...conv, assigneeUid: "u2" }, botAssign: { ...assign, sel: "none" } });
  assert.doesNotMatch(off, /Cùng trả lời với nhân viên/, "không dùng chatbot thì không có công tắc");
  const none = r({ botAssign: null });
  assert.match(none, /Chưa có ở kênh này/);
  assert.doesNotMatch(none, /<span>Trạng thái<\/span>/);
  for (const [kind, label] of [["draft", "Đang gợi ý"], ["handoff", "Cần người hỗ trợ"], ["paused", "Tạm dừng"]]) assert.match(r({ botAssign: assign, botStatus: { kind, text: "x" } }), new RegExp(`>${label}<`), kind);
});

test("tên trạng thái chatbot dùng chung một nguồn: bộ lọc, nút đầu khung chat và cột hồ sơ khớp nhau; Nhường người và Tạm dừng là một", () => {
  assert.deepEqual(BOT_STATES.map(([, l]) => l), ["Tất cả", "Đang phụ trách", "Đang gợi ý", "Cần người hỗ trợ", "Tạm dừng"]);
  assert.deepEqual((["bot", "draft", "handoff", "paused"] as const).map(statusToState), ["handling", "suggesting", "need", "paused"]);
  assert.equal(botPill("none"), "Chatbot");
  assert.equal(botPill("paused"), "Chatbot · Tạm dừng");
  assert.equal(botPill("bot"), "Chatbot · Đang phụ trách");
  const menu = readFileSync(new URL("../src/components/BotMenu.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(menu, /human|Nhường người|nhường người/, "không còn kiểu human trong nút chatbot");
  const side = readFileSync(new URL("../src/components/SidePanel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(side, /Nhường người/);
});

test("ô soạn báo đang gõ lên máy chủ 15 giây một lần chỉ khi hội thoại có chatbot", () => {
  const src = readFileSync(new URL("../src/components/ChatPane.tsx", import.meta.url), "utf8");
  assert.match(src, /bot\.status && bot\.status\.kind !== "none" && Date\.now\(\) - typingAt\.current > 15_000/);
  assert.match(src, /\/typing`, "POST"/);
});

test("ô KP AIbot không lặp tên: một chatbot thì chỉ ghi tên và Không dùng; nhiều chatbot thì Tự động kèm tên, các chatbot còn lại, Không dùng; chọn tay đúng chatbot tự động vẫn có trong danh sách", () => {
  const A = { id: "a", name: "Chốt sale", mode: "auto" }, B = { id: "b", name: "Chăm sóc", mode: "off" };
  assert.deepEqual(botOptions({ options: [A], sel: "", withStaff: false, picked: A, auto: A }), [["", "Chốt sale"], ["none", "Không dùng chatbot"]]);
  assert.deepEqual(botOptions({ options: [A, B], sel: "", withStaff: false, picked: A, auto: A }), [["", "Tự động: Chốt sale"], ["b", "Chăm sóc (tắt)"], ["none", "Không dùng chatbot"]]);
  assert.deepEqual(botOptions({ options: [A, B], sel: "b", withStaff: false, picked: B, auto: A }), [["", "Tự động: Chốt sale"], ["b", "Chăm sóc (tắt)"], ["none", "Không dùng chatbot"]], "chọn tay chatbot khác");
  assert.deepEqual(botOptions({ options: [A, B], sel: "a", withStaff: false, picked: A, auto: A }), [["", "Tự động: Chốt sale"], ["a", "Chốt sale"], ["b", "Chăm sóc (tắt)"], ["none", "Không dùng chatbot"]], "chọn tay trùng chatbot tự động thì vẫn có dòng để hiện đúng lựa chọn");
  assert.deepEqual(botOptions({ options: [A, B], sel: "", withStaff: false, picked: null, auto: null }), [["", "Tự động"], ["a", "Chốt sale"], ["b", "Chăm sóc (tắt)"], ["none", "Không dùng chatbot"]]);
});

test("cột hồ sơ có dòng Đơn hàng với nút + Đơn hàng ngay sau Lead CRM (chỉ là nút, chưa xử lý gì); khách chưa có lead vẫn thấy; chỉ xem thì không có nút", () => {
  const conv = { id: "v", companyId: "x", channelId: "c", contactId: "k", status: "open", labels: [] } as Conversation;
  const contact = { id: "k", companyId: "x", channelId: "c", externalId: "k", name: "Khách A" } as Contact;
  const props = { conv, contact, messages: [], kind: "Messenger", channelName: "Page", me: { uid: "u1" }, staff: DEMO_STAFF, admin: true, canAct: true, avatar: null, onPatch: () => {}, onChanged: () => {}, profile: { linked: { crm: false, pos: false } } };
  const r = (extra: object) => renderToStaticMarkup(createElement(SidePanel, { ...props, ...extra } as Parameters<typeof SidePanel>[0]));
  const html = r({});
  assert.match(html, /<span>Đơn hàng<\/span><b class="kv">Chưa nối POS<\/b><button type="button" class="kc-mini"[^>]*>\+ Đơn hàng<\/button>/);
  assert.ok(html.indexOf("Lead CRM") < html.indexOf("+ Đơn hàng"), "nằm sau dòng Lead CRM");
  assert.match(html, /\+ Tạo lead/);
  assert.doesNotMatch(r({ canAct: false }), /\+ Đơn hàng/);
});
