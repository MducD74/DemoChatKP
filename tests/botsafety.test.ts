// Giai đoạn 0 (vá móng): chuyển người chắc chắn và luật từ khóa không chặn câu hỏi thông tin.
import test from "node:test";
import assert from "node:assert/strict";
import type { DB } from "../src/core/store";
import { PROMISE_REASON, parseReply, promisesStaff } from "../src/core/chatbot";
import { WAIT_HUMAN_REASON, autoGuard } from "../src/core/botauto";

test("chatbot hứa nhờ nhân viên mà quên dấu chuyển người: vẫn là chuyển người, không gửi câu hứa suông", () => {
  const hua = [
    "Dạ để em nhờ nhân viên kiểm tra rồi báo lại anh nhé.",
    "Dạ anh Khai ơi, để em chuyển phần đặt số lượng lớn cho nhân viên hỗ trợ trực tiếp, họ sẽ liên hệ anh sớm nhé.",
    "Dạ em báo lại cho bộ phận bán hàng ạ.",
    "Nhân viên bên em sẽ liên hệ chị trong ít phút ạ.",
    "Dạ em xin phép hỏi lại với quản lý rồi trả lời chị ạ",
  ];
  for (const t of hua) {
    assert.equal(promisesStaff(t), true, t);
    assert.deepEqual(parseReply(t), { kind: "handoff", reason: PROMISE_REASON }, t);
  }
  const khong = [
    "Dạ hộp quà 399k gồm táo, nho, cam ạ. Anh muốn tặng dịp gì ạ?",
    "Dạ shipper sẽ gọi anh trước khi giao ạ.",
    "Dạ anh có thể ghé tiệm ở 34A Hoài Thanh, nhân viên tại quầy hướng dẫn mình chọn mẫu nhé.",
    "Em gửi anh ảnh mẫu giỏ quà ạ",
  ];
  for (const t of khong) {
    assert.equal(promisesStaff(t), false, t);
    assert.equal(parseReply(t)?.kind, "reply", t);
  }
});

const db = (): DB => ({
  channels: { c: { id: "c", kind: "facebook", name: "Page" } },
  contacts: { k: { id: "k", name: "Lan", externalId: "e" } },
  conversations: { v: { id: "v", contactId: "k", channelId: "c", labels: [], lastInboundAt: 2000 } },
  messages: {},
  bot: { settings: { docs: [] }, bots: {}, drafts: { d1: { id: "d1", conversationId: "v", channelId: "c", forInboundAt: 1000, kind: "handoff", text: "", reason: "Khiếu nại", status: "handed", shadow: false, at: 1500 } } },
} as unknown as DB);

test("đã chuyển người mà chưa ai xử lý: chatbot không tự trả lời chen; người trả lời hoặc giao lại thì chatbot chạy lại", () => {
  const d = db();
  const conv = d.conversations.v, ch = d.channels.c;
  assert.equal(autoGuard(d, conv, ch, 3000), WAIT_HUMAN_REASON);
  // nhân viên đã trả lời sau lúc chuyển
  const d2 = db();
  d2.messages.h = { id: "h", conversationId: "v", direction: "out", text: "Dạ em đây", attachments: [], at: 1600, senderUid: "lan" } as never;
  assert.notEqual(autoGuard(d2, d2.conversations.v, d2.channels.c, 1600 + 4 * 3600_000), WAIT_HUMAN_REASON);
  // nhân viên giao lại cho chatbot sau lúc chuyển
  const d3 = db();
  d3.conversations.v.botCtl = { off: false, at: 1700, resumeAt: 1700 } as never;
  assert.equal(autoGuard(d3, d3.conversations.v, d3.channels.c, 3000), null);
});

import { handoffReason } from "../src/core/chatbot";
const msg = (text: string) => [{ text, attachments: [] }] as never;

test("luật từ khóa: việc cần người thì chuyển; câu hỏi thông tin về đặt hàng, thanh toán thì để chatbot trả lời", () => {
  const can = ["Cho mình hủy đơn hôm qua", "Mình chuyển khoản rồi nhé", "Gửi mình số tài khoản với", "Chốt đơn giúp em", "em đã thanh toán rồi", "Đổi hàng giúp chị", "cho em xin stk"];
  for (const t of can) assert.ok(handoffReason(msg(t)), t);
  const khong = ["Đặt hàng như thế nào vậy?", "Thanh toán bằng cách nào, chuyển khoản hay tiền mặt?", "Có cần đặt cọc không?", "Em muốn đặt trước cho cuối tuần được không?", "Mua nhiều có được giảm không?", "Bên mình nhận chuyển khoản không ạ?"];
  for (const t of khong) assert.equal(handoffReason(msg(t)), null, t);
  // các luật khác giữ nguyên
  assert.ok(handoffReason(msg("Cho tôi gặp nhân viên thật")));
  assert.ok(handoffReason(msg("giao sai hàng rồi, tôi muốn hoàn tiền")));
  assert.ok(handoffReason(msg("lấy sỉ giá sao")));
});

import { ADVICE_TEMPLATES, buildSystem, type BotCfg } from "../src/core/chatbot";
test("hướng dẫn tư vấn có sẵn: chatbot cũ vẫn có bản ẩn; đã chép ra ô Nhiệm vụ thì không thêm bản ẩn; ngày hôm nay nằm cuối lời nhắc", () => {
  const d = { channels: { c: { id: "c", kind: "web", name: "Web" } }, contacts: {}, conversations: {}, messages: {} } as unknown as DB;
  const base = { id: "b", name: "B", type: "new", channelIds: ["c"], mode: "draft", tone: "", instructions: "", docIds: [], useTemplates: false, model: "m", intro: "", at: 0 } as BotCfg;
  const t = ADVICE_TEMPLATES();
  const head = t.new.split("\n")[0];
  const legacy = buildSystem(d, base, d.channels.c, "Khách");
  assert.ok(legacy.includes(head));
  const inline = buildSystem(d, { ...base, adviceInline: true, instructions: "Bạn tư vấn quà tặng." }, d.channels.c, "Khách");
  assert.ok(!inline.includes(head), "không lặp bản ẩn");
  assert.match(inline, /NHIỆM VỤ VÀ QUY TẮC CỦA QUẢN TRỊ:\nBạn tư vấn quà tặng\./);
  assert.ok(inline.indexOf("HÔM NAY:") > inline.indexOf("Định dạng trả lời"), "ngày nằm sau phần cố định");
});

import { startEvalRun, saveEvalSet } from "../src/core/botevals";
test("người chấm thấy đủ kiến thức chatbot thấy (không cắt ở 14.000 ký tự), để không chấm nhầm thông tin đúng là bịa", async () => {
  const s = { db: { channels: { c: { id: "c", kind: "web", name: "Web" } }, contacts: {}, conversations: {}, messages: {}, bot: { settings: { docs: [
    { id: "d1", title: "Sản phẩm", body: "x".repeat(15000), at: 1 },
    { id: "d2", title: "Giao hàng", body: "Giảm 20k phí ship cho đơn trên 290k", at: 1 },
  ] }, bots: { b: { id: "b", name: "B", type: "new", channelIds: ["c"], mode: "draft", tone: "", instructions: "", docIds: ["d1", "d2"], useTemplates: false, model: "m", intro: "", at: 0 } }, drafts: {} } } as unknown as DB,
    async load() { return structuredClone(this.db); }, async save(d: DB) { this.db = d; } };
  const set = await saveEvalSet(s as never, { name: "Thử", botId: "b", items: [{ group: "Giao hàng", question: "Phí ship sao?", expect: "answer" }] });
  assert.ok(set.ok);
  const seen: string[] = [];
  const provider = { id: "f", async complete(req: { system: string; messages: { content: string }[] }) { seen.push(req.messages[0].content); return { ok: true as const, text: seen.length === 1 ? "Dạ giảm 20k phí ship cho đơn trên 290k ạ" : '{"hoi_nhu_cau":null,"dung_thong_tin":2,"goi_y_dung":null,"xu_ly_tu_choi":null,"buoc_tiep":1,"giong":2,"ngan_gon":2,"why":"ok"}', usage: { input: 1, output: 1 } }; } };
  const r = await startEvalRun(s as never, set.ok ? set.set.id : "", { judge: true, provider: provider as never });
  assert.ok(r.ok);
  if (r.ok) await r.done;
  assert.match(seen[1], /Giảm 20k phí ship cho đơn trên 290k/, "người chấm thấy tài liệu thứ hai");
});
