import test from "node:test";
import assert from "node:assert/strict";
import type { DB, Store } from "../src/core/store";
import type { BotCfg } from "../src/core/chatbot";
import { pickBot } from "../src/core/chatbot";
import { AUTO_MAX_PER_CONV, CAP_REASON, TYPING_HOLD_MS, TYPING_REASON, autoGuard, capFreeAt } from "../src/core/botauto";
import { botAssignInfo, botHandlers, markTyping, setBotAssign } from "../src/core/botassign";
import { handBack, handlerStatus } from "../src/core/botreview";
import { listConversations } from "../src/core/service";
import { DEMO_STAFF } from "../src/core/staff";
import { ASSISTANT_NONE, BOT_STATES, HANDOFF_LABEL, matchAssistant, matchBotState, type BotState } from "../src/core/botfilter";

const [ADMIN, LAN, HAI] = DEMO_STAFF;
const T0 = 1_700_000_000_000;
const mem = () => {
  const s = { db: { channels: {}, contacts: {}, conversations: {}, messages: {} } as DB,
    async load() { return structuredClone(s.db); }, async save(d: DB) { s.db = d; } };
  return s as Store & { db: DB };
};
const bot = (id: string, over: Partial<BotCfg> = {}): BotCfg => ({ id, name: `Bot ${id}`, type: "new", channelIds: ["c"], mode: "auto", tone: "", instructions: "", docIds: [], useTemplates: false, model: "m", intro: "", at: Number(id.replace(/\D/g, "")) || 1, ...over });
const setup = () => {
  const s = mem();
  s.db.channels["c"] = { id: "c", companyId: "x", kind: "facebook", externalId: "P", name: "Fanpage", sendEnabled: true, access: { [LAN.uid]: "send", [HAI.uid]: "view" } };
  s.db.contacts["k"] = { id: "k", companyId: "x", channelId: "c", externalId: "k", name: "Khách A" };
  s.db.conversations["v"] = { id: "v", companyId: "x", channelId: "c", contactId: "k", status: "open", labels: [], lastInboundAt: T0, lastMessageAt: T0 };
  s.db.messages["m"] = { id: "m", companyId: "x", conversationId: "v", externalId: "m", direction: "in", text: "hi", attachments: [], at: T0, };
  s.db.bot = { settings: { docs: [] }, bots: { b1: bot("b1"), b2: bot("b2", { type: "care", name: "Bot chăm sóc" }), b3: bot("b3", { name: "Bot nháp", mode: "draft" }), b4: bot("b4", { name: "Bot tắt", mode: "off" }) }, drafts: {} };
  return s;
};
const NOW = T0 + 60_000;
const conv = (s: { db: DB }) => s.db.conversations["v"];

test("chọn chatbot cho hội thoại: theo kênh như cũ; chọn tay một chatbot; không dùng bot; chatbot đã tắt thì không trả lời", async () => {
  const s = setup();
  assert.equal(pickBot(s.db, "v", NOW)?.id, "b1", "mặc định theo kênh và loại khách");
  assert.equal((await setBotAssign(s, "v", { bot: "b2" }, LAN)).ok, true);
  assert.equal(pickBot(s.db, "v", NOW)?.id, "b2", "chọn tay chatbot chăm sóc dù khách mới");
  await setBotAssign(s, "v", { bot: "b4" }, LAN);
  assert.equal(pickBot(s.db, "v", NOW), null, "chatbot đang tắt thì bot không trả lời");
  assert.equal(pickBot(s.db, "v", NOW, { any: true })?.id, "b4", "nút Gợi ý vẫn dùng được");
  await setBotAssign(s, "v", { bot: "none" }, LAN);
  assert.equal(pickBot(s.db, "v", NOW), null, "không dùng bot");
  assert.equal(pickBot(s.db, "v", NOW, { any: true })?.id !== undefined, true, "nhân viên vẫn xin gợi ý được");
  await setBotAssign(s, "v", { bot: "" }, LAN);
  assert.equal(conv(s).botSel, undefined, "về theo kênh thì xóa lựa chọn");
  assert.equal(pickBot(s.db, "v", NOW)?.id, "b1");
});

test("phân công chatbot: kiểm chatbot thuộc kênh, chỉ người có quyền, ghi lịch sử", async () => {
  const s = setup();
  s.db.bot!.bots!["b9"] = bot("b9", { channelIds: ["khac"] });
  assert.equal((await setBotAssign(s, "v", { bot: "b9" }, LAN)).ok, false, "chatbot kênh khác");
  assert.equal((await setBotAssign(s, "v", { bot: "không có" }, LAN)).ok, false);
  assert.equal((await setBotAssign(s, "v", { bot: "b3" }, HAI)).ok, false, "chỉ xem thì không đổi được");
  assert.equal((await setBotAssign(s, "không có", { bot: "b3" }, LAN)).ok, false);
  assert.equal(conv(s).botSel, undefined);
  await setBotAssign(s, "v", { bot: "b3" }, LAN);
  await setBotAssign(s, "v", { bot: "b3" }, LAN); // không đổi: không ghi thêm
  await setBotAssign(s, "v", { bot: "none", withStaff: true }, ADMIN);
  assert.equal(conv(s).botSel?.withStaff, undefined, "không dùng bot thì không có 'cùng trả lời'");
  assert.deepEqual((conv(s).log ?? []).map((l) => l.text), ["Chatbot phụ trách: theo kênh → Bot nháp", "Chatbot phụ trách: Bot nháp → không dùng chatbot"]);
});

test("nhân viên và chatbot cùng phụ trách: mặc định bot nhường khi có người nhận; bật 'trả lời cùng' thì bot vẫn trả lời; người vừa trả lời thì bot vẫn tạm dừng", async () => {
  const s = setup();
  const ch = s.db.channels["c"];
  conv(s).assigneeUid = LAN.uid; conv(s).autoAssigned = false;
  assert.equal(autoGuard(s.db, conv(s), ch, NOW), "Nhân viên đã nhận hội thoại này");
  assert.equal(handlerStatus(s.db, "v", ADMIN, NOW).kind, "paused", "nhường người là Tạm dừng");
  await setBotAssign(s, "v", { bot: "", withStaff: true }, LAN);
  assert.equal(autoGuard(s.db, conv(s), ch, NOW), null, "bot được trả lời cùng nhân viên");
  const st = handlerStatus(s.db, "v", ADMIN, NOW);
  assert.equal(st.kind, "bot");
  assert.match(st.text, /Bot b1 đang trả lời, cùng .* phụ trách/);
  s.db.messages["o"] = { id: "o", companyId: "x", conversationId: "v", externalId: "o", direction: "out", text: "Dạ", attachments: [], at: NOW - 1000, senderUid: LAN.uid };
  assert.equal(autoGuard(s.db, conv(s), ch, NOW), "Người vừa trả lời, chatbot tạm dừng", "nhân viên trả lời thì bot nhường một giờ");
  conv(s).botCtl = { off: true, by: LAN.uid, at: NOW };
  assert.equal(handlerStatus(s.db, "v", ADMIN, NOW).kind, "paused", "Tiếp quản vẫn dừng bot hẳn");
});

test("thông tin phân công trả về các chatbot của kênh, lựa chọn hiện tại và chatbot sẽ trả lời; kênh chưa có chatbot thì không có", async () => {
  const s = setup();
  const a = botAssignInfo(s.db, "v", NOW)!;
  assert.deepEqual(a.options.map((o) => o.id), ["b1", "b2", "b3", "b4"]);
  assert.equal(a.sel, "");
  assert.equal(a.picked?.id, "b1");
  assert.equal(a.auto?.id, "b1", "chatbot tự động theo giai đoạn");
  await setBotAssign(s, "v", { bot: "none" }, LAN);
  assert.deepEqual([botAssignInfo(s.db, "v", NOW)!.sel, botAssignInfo(s.db, "v", NOW)!.picked], ["none", null]);
  assert.equal(botAssignInfo(s.db, "v", NOW)!.auto?.id, "b1", "không dùng chatbot thì vẫn biết chatbot tự động là ai");
  await setBotAssign(s, "v", { bot: "b2" }, LAN);
  assert.deepEqual([botAssignInfo(s.db, "v", NOW)!.picked?.id, botAssignInfo(s.db, "v", NOW)!.auto?.id], ["b2", "b1"], "chọn tay b2 nhưng tự động vẫn là b1");
  s.db.bot!.bots = {};
  assert.equal(botAssignInfo(s.db, "v", NOW), null);
});

test("danh sách hội thoại có chip chatbot đang xử lý: tự trả lời hoặc soạn nháp; không hiện khi bot nhường nhân viên, đã tiếp quản, đã xong, hay hệ thống tạm dừng", async () => {
  const s = setup();
  const chip = async () => { const b = (await listConversations(s, { actor: ADMIN, status: "all" }))[0].bot; return b && b.state !== "paused" ? b : undefined; }; // chip chỉ hiện khi bot đang phụ trách hoặc soạn nháp
  const realNow = Date.now;
  Date.now = () => NOW; // listConversations dùng giờ hiện tại
  try {
    assert.deepEqual(await chip(), { id: "b1", name: "Bot b1", mode: "auto", withStaff: false, state: "handling" });
    await setBotAssign(s, "v", { bot: "b3" }, LAN);
    assert.deepEqual(await chip(), { id: "b3", name: "Bot nháp", mode: "draft", withStaff: false, state: "suggesting" });
    await setBotAssign(s, "v", { bot: "" }, LAN);
    conv(s).assigneeUid = LAN.uid; conv(s).autoAssigned = false;
    assert.equal(await chip(), undefined, "bot tự động nhường khi có nhân viên");
    await setBotAssign(s, "v", { bot: "", withStaff: true }, LAN);
    assert.deepEqual(await chip(), { id: "b1", name: "Bot b1", mode: "auto", withStaff: true, state: "handling" });
    conv(s).botCtl = { off: true, by: LAN.uid, at: NOW };
    assert.equal(await chip(), undefined, "đã tiếp quản");
    conv(s).botCtl = undefined; conv(s).status = "resolved";
    assert.equal(await chip(), undefined, "đã xong");
    conv(s).status = "open"; s.db.bot!.settings.paused = true;
    assert.equal(await chip(), undefined, "tạm dừng toàn hệ thống");
    assert.deepEqual([...botHandlers(s.db, NOW).values()].map((x) => x.state), ["paused"]);
  } finally { Date.now = realNow; }
});

test("bộ lọc Trợ lý AI và Trạng thái chatbot: lọc theo chatbot phụ trách và theo việc chatbot đang làm", () => {
  assert.deepEqual(BOT_STATES.map(([k]) => k), ["all", "handling", "suggesting", "need", "paused"]);
  type It = { bot?: { id: string }; botState?: BotState };
  const items: Record<string, It> = { phuTrach: { bot: { id: "b1" }, botState: "handling" }, goiY: { bot: { id: "b3" }, botState: "suggesting" }, canNguoi: { bot: { id: "b1" }, botState: "need" }, tamDung: { bot: { id: "b2" }, botState: "paused" }, khong: { botState: "none" }, thieu: {} };
  const names = Object.keys(items);
  const byState = (sel: string) => names.filter((n) => matchBotState(items[n], sel));
  assert.deepEqual(byState("all"), names);
  assert.deepEqual(byState(""), names);
  assert.deepEqual(byState("handling"), ["phuTrach"]);
  assert.deepEqual(byState("suggesting"), ["goiY"]);
  assert.deepEqual(byState("need"), ["canNguoi"]);
  assert.deepEqual(byState("paused"), ["tamDung"]);
  assert.deepEqual(byState("none"), ["khong", "thieu"], "thiếu trạng thái tính là không có chatbot");
  const byBot = (sel: string) => names.filter((n) => matchAssistant(items[n], sel));
  assert.deepEqual(byBot("all"), names);
  assert.deepEqual(byBot("b1"), ["phuTrach", "canNguoi"], "lọc theo trợ lý gồm cả hội thoại bot đang cần người");
  assert.deepEqual(byBot("b2"), ["tamDung"], "tạm dừng vẫn thuộc trợ lý đó");
  assert.deepEqual(byBot(ASSISTANT_NONE), ["khong", "thieu"]);
  assert.deepEqual(byBot("b-khac"), []);
  assert.equal(HANDOFF_LABEL, "Bot: cần người");
});

test("danh sách hội thoại có trạng thái chatbot: phụ trách, gợi ý, tạm dừng (người nhận, đã tiếp quản, hết hạn mức, hệ thống dừng), cần người, không có", async () => {
  const s = setup();
  const realNow = Date.now;
  Date.now = () => NOW;
  try {
    const st = async () => { const it = (await listConversations(s, { actor: ADMIN, status: "all" }))[0]; return [it.botState, it.bot?.state, it.bot?.id]; };
    assert.deepEqual(await st(), ["handling", "handling", "b1"]);
    await setBotAssign(s, "v", { bot: "b3" }, LAN);
    assert.deepEqual(await st(), ["suggesting", "suggesting", "b3"]);
    await setBotAssign(s, "v", { bot: "" }, LAN);
    conv(s).assigneeUid = LAN.uid; conv(s).autoAssigned = false;
    assert.deepEqual(await st(), ["paused", "paused", "b1"], "có nhân viên nhận thì bot nhường: tạm dừng nhưng vẫn thuộc trợ lý b1");
    await setBotAssign(s, "v", { bot: "", withStaff: true }, LAN);
    assert.deepEqual(await st(), ["handling", "handling", "b1"], "bot cùng trả lời với nhân viên");
    conv(s).botCtl = { off: true, by: LAN.uid, at: NOW };
    assert.equal((await st())[0], "paused", "đã tiếp quản");
    conv(s).botCtl = undefined; s.db.bot!.settings.paused = true;
    assert.equal((await st())[0], "paused", "hệ thống tạm dừng chatbot");
    s.db.bot!.settings.paused = false;
    s.db.bot!.drafts["d1"] = { id: "d1", conversationId: "v", channelId: "c", forInboundAt: T0, kind: "handoff", text: "", reason: "Khiếu nại", status: "handed", shadow: false, at: NOW - 1000 } as never;
    assert.equal((await st())[0], "need", "bot đã chuyển người thì là cần người");
    s.db.bot!.bots = {};
    assert.deepEqual(await st(), ["need", undefined, undefined], "không còn chatbot nào nhưng vẫn còn ca cần người");
    s.db.bot!.drafts = {};
    assert.deepEqual(await st(), ["none", undefined, undefined]);
    conv(s).status = "resolved";
  } finally { Date.now = realNow; }
});

test("bot chạm hạn mức tin trong 24 giờ: nói rõ lý do và lúc tự mở lại, có nút Giao lại cho chatbot; giao lại thì làm mới hạn mức", async () => {
  const s = setup();
  const ch = s.db.channels["c"];
  const DAY = 24 * 3600_000;
  for (let i = 0; i < AUTO_MAX_PER_CONV; i++) s.db.messages[`bm${i}`] = { id: `bm${i}`, companyId: "x", conversationId: "v", externalId: `bm${i}`, direction: "out", text: "Dạ", attachments: [], at: T0 + (i + 1) * 1000, bot: true };
  assert.equal(autoGuard(s.db, conv(s), ch, NOW), CAP_REASON);
  assert.equal(capFreeAt(s.db, conv(s), NOW), T0 + 1000 + DAY, "mở lại khi tin cũ nhất quá 24 giờ");
  const st = handlerStatus(s.db, "v", ADMIN, NOW);
  assert.equal(st.kind, "paused");
  assert.match(st.text, new RegExp(`${AUTO_MAX_PER_CONV} tin cho khách này trong 24 giờ`));
  assert.match(st.text, /Tự mở lại lúc/);
  assert.equal(st.canBack, true, "nhân viên có thể bấm Giao lại cho chatbot");
  // sau 24 giờ tin cũ nhất, hạn mức tự mở lại
  assert.equal(autoGuard(s.db, conv(s), ch, T0 + 1000 + DAY + 1), null);
  assert.equal(capFreeAt(s.db, conv(s), T0 + 1000 + DAY + 1), null);
  // giao lại cho bot: tin bot trước đó không còn tính vào hạn mức
  assert.equal((await handBack(s, "v", LAN)).ok, true);
  assert.equal(autoGuard(s.db, conv(s), ch, NOW), null, "giao lại thì bot trả lời tiếp");
  assert.equal(capFreeAt(s.db, conv(s), NOW), null);
  assert.equal(handlerStatus(s.db, "v", ADMIN, NOW).kind, "bot");
  // dưới hạn mức thì không có gì
  const s2 = setup();
  s2.db.messages["only"] = { id: "only", companyId: "x", conversationId: "v", externalId: "only", direction: "out", text: "Dạ", attachments: [], at: T0 + 1000, bot: true };
  assert.equal(autoGuard(s2.db, s2.db.conversations["v"], s2.db.channels["c"], NOW), null);
  assert.equal(capFreeAt(s2.db, s2.db.conversations["v"], NOW), null);
});

import { botStages, DEFAULT_BOT_STAGES, saveBot } from "../src/core/chatbot";
import { updateConversation } from "../src/core/service";

test("trợ lý AI chọn theo Giai đoạn CRM của khách: Chuyển đổi giao cho chăm sóc, Mới đến Gần chốt giao cho chốt sale, chưa có giai đoạn thì theo luật khách mới/cũ", () => {
  const s = setup();
  assert.deepEqual(DEFAULT_BOT_STAGES, { new: ["new", "interest", "potential", "near"], care: ["won"] });
  assert.deepEqual(botStages(s.db.bot!.bots!["b2"]), ["won"]);
  assert.deepEqual(botStages({ type: "care", stages: ["won", "lost"] }), ["won", "lost"]);
  const pick = (stage?: string) => { conv(s).stage = stage; return pickBot(s.db, "v", NOW)?.id; };
  assert.equal(pick(undefined), "b1", "chưa có giai đoạn, khách mới (dưới 7 ngày): chốt sale");
  assert.equal(pick("near"), "b1");
  assert.equal(pick("won"), "b2", "khách đã mua dù hội thoại mới thì giao cho trợ lý chăm sóc");
  assert.equal(pick("lost"), "b1", "Mất/Spam không trợ lý nào phụ trách: dùng luật cũ");
  // khách cũ (hơn 7 ngày) đang ở giai đoạn Quan tâm vẫn do chốt sale phụ trách
  const later = T0 + 30 * 24 * 3600_000;
  conv(s).stage = undefined;
  assert.equal(pickBot(s.db, "v", later)?.id, "b2", "chưa có giai đoạn, khách cũ: chăm sóc");
  conv(s).stage = "interest";
  assert.equal(pickBot(s.db, "v", later)?.id, "b1", "có giai đoạn thì theo giai đoạn");
  // nhân viên chọn tay vẫn thắng giai đoạn
  conv(s).botSel = { botId: "b2", by: LAN.uid, at: 1 };
  assert.equal(pickBot(s.db, "v", later)?.id, "b2");
  conv(s).botSel = { none: true, by: LAN.uid, at: 1 };
  assert.equal(pickBot(s.db, "v", later), null);
  // chatbot phụ trách giai đoạn đang tắt: không trả lời, nhưng nút Gợi ý vẫn dùng được
  conv(s).botSel = undefined; s.db.bot!.bots!["b2"].mode = "off";
  conv(s).stage = "won";
  assert.equal(pickBot(s.db, "v", NOW)?.id, "b1", "chatbot chăm sóc tắt thì rơi về luật cũ");
  assert.equal(pickBot(s.db, "v", NOW, { any: true })?.id, "b2", "xin gợi ý thì lấy chatbot phụ trách giai đoạn dù đang tắt");
});

test("đổi Giai đoạn CRM thì trợ lý AI đổi theo và lịch sử ghi lại; không đổi trợ lý thì không ghi", async () => {
  const s = setup();
  s.db.messages["m"].at = Date.now(); // hội thoại mới: chưa có giai đoạn thì là khách mới
  await updateConversation(s, "v", { stage: "near" }, LAN);
  assert.equal((conv(s).log ?? []).some((l) => l.text.startsWith("Trợ lý AI")), false, "chưa có giai đoạn và có giai đoạn Gần chốt đều là chốt sale: không đổi trợ lý");
  await updateConversation(s, "v", { stage: "won" }, LAN);
  assert.equal(conv(s).log!.at(-1)!.text, "Chatbot: Bot b1 → Bot chăm sóc (theo giai đoạn CRM)");
  await updateConversation(s, "v", { stage: "interest" }, LAN);
  assert.equal(conv(s).log!.at(-1)!.text, "Chatbot: Bot chăm sóc → Bot b1 (theo giai đoạn CRM)");
});

test("lưu chatbot với giai đoạn phụ trách: kiểm khóa giai đoạn, không để trống, mỗi giai đoạn ở một kênh chỉ một chatbot; không khai thì theo loại", async () => {
  const s = mem();
  s.db.channels["c"] = { id: "c", companyId: "x", kind: "facebook", externalId: "P", name: "Fanpage", sendEnabled: true };
  s.db.bot = { settings: { docs: [] }, bots: {}, drafts: {} };
  const base = { name: "A", type: "new", channelIds: ["c"], mode: "draft", tone: "t", instructions: "", docIds: [], model: undefined as unknown };
  const a = await saveBot(s, { ...base, name: "Chốt sale" });
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(a.ok && a.bot.stages, undefined, "không khai giai đoạn thì lưu theo loại");
  assert.equal(a.ok && botStages(a.bot).join(), "new,interest,potential,near");
  const bad = async (stages: unknown, over = {}) => (await saveBot(s, { ...base, name: "B", type: "care", stages, ...over })).ok;
  assert.equal(await bad(["won", "không có"]), false, "khóa giai đoạn lạ");
  assert.equal(await bad([]), false, "để trống");
  assert.equal(await bad(["near"]), false, "Gần chốt đã do chatbot chốt sale phụ trách ở kênh này");
  const care = await saveBot(s, { ...base, name: "Chăm sóc", type: "care", stages: ["lost", "won", "won"] });
  assert.equal(care.ok, true, JSON.stringify(care));
  assert.deepEqual(care.ok && care.bot.stages, ["won", "lost"], "sắp theo thứ tự giai đoạn, bỏ trùng");
  const clash = await saveBot(s, { ...base, name: "Chăm sóc 2", type: "care", stages: ["won"] });
  assert.equal(clash.ok, false);
  // sửa lại chính chatbot chăm sóc không bị coi là trùng với chính nó
  assert.equal((await saveBot(s, { ...base, id: care.ok ? care.bot.id : "", name: "Chăm sóc", type: "care", stages: ["won"] })).ok, true);
});

test("nhân viên đang gõ trong ô soạn: chatbot chờ 2 phút kể từ lần báo cuối, trạng thái Tạm dừng kèm lý do; hết hạn thì chatbot trả lời lại; chỉ người có quyền báo được", async () => {
  const s = setup();
  const ch = s.db.channels["c"];
  assert.equal(autoGuard(s.db, conv(s), ch, NOW), null);
  assert.equal((await markTyping(s, "v", HAI, NOW)).ok, false, "chỉ xem thì không báo được");
  assert.equal(conv(s).typingAt, undefined);
  assert.equal((await markTyping(s, "không có", LAN, NOW)).ok, false);
  assert.equal((await markTyping(s, "v", LAN, NOW)).ok, true);
  assert.equal(conv(s).typingAt, NOW);
  assert.equal(autoGuard(s.db, conv(s), ch, NOW + 1000), TYPING_REASON);
  assert.equal(autoGuard(s.db, conv(s), ch, NOW + TYPING_HOLD_MS - 1), TYPING_REASON);
  assert.equal(autoGuard(s.db, conv(s), ch, NOW + TYPING_HOLD_MS), null, "hết 2 phút thì chatbot trả lời lại");
  const st = handlerStatus(s.db, "v", ADMIN, NOW + 1000);
  assert.equal(st.kind, "paused");
  assert.equal(st.text, TYPING_REASON);
  // gõ tiếp thì gia hạn; báo dồn dập trong 10 giây không ghi lại nhiều lần
  await markTyping(s, "v", LAN, NOW + 5000);
  assert.equal(conv(s).typingAt, NOW, "dưới 10 giây thì bỏ qua");
  await markTyping(s, "v", LAN, NOW + 60_000);
  assert.equal(conv(s).typingAt, NOW + 60_000);
  assert.equal(autoGuard(s.db, conv(s), ch, NOW + 60_000 + TYPING_HOLD_MS - 1), TYPING_REASON, "gia hạn thêm 2 phút");
  // cũng chặn khi nhân viên cho chatbot trả lời cùng
  conv(s).assigneeUid = LAN.uid; conv(s).autoAssigned = false;
  await setBotAssign(s, "v", { bot: "", withStaff: true }, LAN);
  conv(s).typingAt = NOW;
  assert.equal(autoGuard(s.db, conv(s), ch, NOW + 1000), TYPING_REASON);
  // danh sách: hội thoại đang chờ vì có người gõ là Tạm dừng
  const realNow = Date.now; Date.now = () => NOW + 1000;
  try { assert.equal((await listConversations(s, { actor: ADMIN, status: "all" }))[0].botState, "paused"); } finally { Date.now = realNow; }
});
