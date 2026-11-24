// Thương hiệu: kênh thuộc một thương hiệu; chatbot và tài liệu cùng thương hiệu; lời nhắc không bao giờ chứa tài liệu thương hiệu khác.
import test from "node:test";
import assert from "node:assert/strict";
import type { DB, Store } from "../src/core/store";
import { SHARED, brandOfChannel, deleteBrand, saveBrand } from "../src/core/brands";
import { buildSystem, saveBot, saveBotSettings, type BotCfg } from "../src/core/chatbot";
import { ingest } from "../src/core/ingest";

const mem = () => {
  const s = { db: { channels: {
    fx: { id: "fx", kind: "facebook", name: "Page Xuxi", externalId: "PX", companyId: "x", sendEnabled: true },
    fl: { id: "fl", kind: "facebook", name: "Page Labanfood", externalId: "PL", companyId: "x", sendEnabled: true },
    zt: { id: "zt", kind: "zalo_oa", name: "Zalo La Bàn Travel", externalId: "ZT", companyId: "x", sendEnabled: true },
  }, contacts: {}, conversations: {}, messages: {} } as unknown as DB,
    async load() { return structuredClone(s.db); }, async save(d: DB) { s.db = d; } };
  return s as Store & { db: DB };
};
const bot = (over: Partial<BotCfg>) => ({ name: "B", type: "new", channelIds: ["fx"], mode: "draft", tone: "", instructions: "", docIds: [], useTemplates: false, model: "claude-haiku-5-5", intro: "", ...over });

async function setup() {
  const s = mem();
  const x = await saveBrand(s, { name: "Xuxi Fruit", channelIds: ["fx"] });
  const l = await saveBrand(s, { name: "Labanfood", channelIds: ["fl"] });
  assert.ok(x.ok && l.ok);
  if (!x.ok || !l.ok) throw new Error();
  await saveBotSettings(s, { docs: [
    { title: "Giá giỏ quà Xuxi", body: "Giỏ 399k", brandId: x.brand.id },
    { title: "Giá thực phẩm Labanfood", body: "Ruốc 120k", brandId: l.brand.id },
    { title: "Giới thiệu Labancorp", body: "Tập đoàn", brandId: SHARED },
    { title: "Tài liệu cũ chưa gắn", body: "Không rõ" },
  ] } as never);
  const ids = Object.fromEntries(s.db.bot!.settings.docs.map((d) => [d.title, d.id]));
  return { s, X: x.brand.id, L: l.brand.id, ids };
}

test("thương hiệu: mỗi kênh chỉ thuộc một thương hiệu; tên không trùng; xóa bị chặn khi còn chatbot hay tài liệu", async () => {
  const { s, X, L } = await setup();
  const dup = await saveBrand(s, { name: "Khác", channelIds: ["fx"] });
  assert.equal(dup.ok, false); assert.match(!dup.ok ? dup.error : "", /đã thuộc thương hiệu "Xuxi Fruit"/);
  assert.equal((await saveBrand(s, { name: "xuxi fruit", channelIds: [] })).ok, false);
  assert.equal(brandOfChannel(s.db, "fx"), X);
  assert.equal(brandOfChannel(s.db, "zt"), undefined);
  assert.equal((await deleteBrand(s, L)).ok, false, "còn tài liệu Labanfood");
});

test("chatbot: có thương hiệu thì phải chọn; kênh và tài liệu phải cùng thương hiệu hoặc Dùng chung; khóa thương hiệu sau khi gắn", async () => {
  const { s, X, L, ids } = await setup();
  assert.match(String((await saveBot(s, bot({})) as { error?: string }).error), /Chọn thương hiệu/);
  assert.match(String((await saveBot(s, bot({ brandId: X, channelIds: ["fl"] })) as { error?: string }).error), /không thuộc thương hiệu "Xuxi Fruit"/);
  assert.match(String((await saveBot(s, bot({ brandId: X, docIds: [ids["Giá thực phẩm Labanfood"]] })) as { error?: string }).error), /thuộc thương hiệu khác/);
  assert.match(String((await saveBot(s, bot({ brandId: X, docIds: [ids["Tài liệu cũ chưa gắn"]] })) as { error?: string }).error), /chưa gắn thương hiệu/);
  const ok = await saveBot(s, bot({ brandId: X, docIds: [ids["Giá giỏ quà Xuxi"], ids["Giới thiệu Labancorp"]] }));
  assert.ok(ok.ok);
  if (!ok.ok) return;
  assert.equal(ok.bot.brandId, X);
  const moved = await saveBot(s, { ...ok.bot, brandId: L, channelIds: ["fl"] });
  assert.equal(moved.ok, false); assert.match(!moved.ok ? moved.error : "", /Không đổi được thương hiệu/);
  // không gỡ được kênh khỏi thương hiệu khi chatbot của thương hiệu còn dùng
  const brand = s.db.bot!.brands!.find((b) => b.id === X)!;
  assert.equal((await saveBrand(s, { id: X, name: brand.name, channelIds: [] })).ok, false);
});

test("lời nhắc chỉ chứa tài liệu cùng thương hiệu hoặc Dùng chung, kể cả khi dữ liệu cũ lỡ gắn tài liệu thương hiệu khác", async () => {
  const { s, X, ids } = await setup();
  const b = { id: "b1", ...bot({ brandId: X, docIds: Object.values(ids) }), at: 0 } as BotCfg; // dữ liệu cũ lỡ gắn mọi tài liệu
  const sys = buildSystem(s.db, b, s.db.channels.fx, "Khách");
  assert.match(sys, /Giá giỏ quà Xuxi/); assert.match(sys, /Giới thiệu Labancorp/);
  assert.doesNotMatch(sys, /Ruốc 120k/); assert.doesNotMatch(sys, /Tài liệu cũ chưa gắn/);
  // chatbot cũ chưa có thương hiệu: không lọc (như trước)
  const legacy = buildSystem(s.db, { ...b, brandId: undefined }, s.db.channels.fx, "Khách");
  assert.match(legacy, /Ruốc 120k/);
});

test("hội thoại mới được gắn cố định thương hiệu của kênh lúc tạo", async () => {
  const { s, X } = await setup();
  await ingest(s, "facebook", [{ channelExternalId: "PX", contact: { externalId: "u1", name: "Lan" }, message: { externalId: "m1", direction: "in", text: "Chào shop", attachments: [], at: Date.now() } }]);
  await ingest(s, "zalo_oa", [{ channelExternalId: "ZT", contact: { externalId: "u2", name: "Hà" }, message: { externalId: "m2", direction: "in", text: "Tour Huế", attachments: [], at: Date.now() } }]);
  const convs = Object.values(s.db.conversations);
  assert.equal(convs.find((c) => c.channelId === "fx")?.brandId, X);
  assert.equal(convs.find((c) => c.channelId === "zt")?.brandId, undefined, "kênh chưa gắn thương hiệu");
});

import { PROFILE_FIELDS, PROFILE_LIMITS, filledCount, profilePrompt } from "../src/core/brandprofile";

test("hồ sơ thương hiệu: điền một lần, mọi chatbot của thương hiệu dùng; mục chưa điền được nêu rõ để không bịa; thương hiệu khác không thấy", async () => {
  const { s, X, L } = await setup();
  const r = await saveBrand(s, { id: X, name: "Xuxi Fruit", channelIds: ["fx"], kind: "retail", profile: { delivery: "Giao nội thành. Giảm 20k ship đơn trên 290k.", payment: "Chuyển khoản trước.", khongco: "bỏ qua" } });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(Object.keys(r.brand.profile!), ["delivery", "payment"], "khóa lạ bị bỏ");
  assert.equal(filledCount("retail", r.brand.profile), 2);
  assert.ok(r.brand.profileAt);
  const a = await saveBot(s, bot({ brandId: X, name: "Xuxi A" }));
  const b2 = await saveBot(s, { ...bot({ brandId: L, channelIds: ["fl"], name: "Labanfood A" }) });
  assert.ok(a.ok && b2.ok);
  if (!a.ok || !b2.ok) return;
  const sysX = buildSystem(s.db, a.bot, s.db.channels.fx, "Khách");
  assert.match(sysX, /THÔNG TIN CHÍNH THỨC CỦA XUXI FRUIT/);
  assert.match(sysX, /### Giao hàng\nGiao nội thành\. Giảm 20k ship đơn trên 290k\./);
  assert.match(sysX, /CHƯA CÓ THÔNG TIN[^\n]*Đổi trả và hoàn tiền[^\n]*Hóa đơn|CHƯA CÓ THÔNG TIN[^\n]*Đổi trả và hoàn tiền/);
  const sysL = buildSystem(s.db, b2.bot, s.db.channels.fl, "Khách");
  assert.doesNotMatch(sysL, /Giảm 20k ship/, "thương hiệu khác không thấy hồ sơ");
  // sửa hồ sơ: chatbot dùng ngay bản mới (không lưu bản chép trong chatbot)
  await saveBrand(s, { id: X, name: "Xuxi Fruit", channelIds: ["fx"], profile: { delivery: "Giao toàn quốc." } });
  assert.match(buildSystem(s.db, a.bot, s.db.channels.fx, "Khách"), /Giao toàn quốc\./);
  assert.doesNotMatch(buildSystem(s.db, a.bot, s.db.channels.fx, "Khách"), /Giảm 20k ship/);
});

test("hồ sơ thương hiệu: giới hạn độ dài; loại du lịch có bộ mục riêng; không có hồ sơ thì không thêm gì", async () => {
  const { s, X } = await setup();
  const big = await saveBrand(s, { id: X, name: "Xuxi Fruit", channelIds: ["fx"], profile: { delivery: "x".repeat(PROFILE_LIMITS.field + 1) } });
  assert.equal(big.ok, false);
  const t = await saveBrand(s, { name: "La Bàn Travel", channelIds: ["zt"], kind: "travel", profile: { licence: "GP lữ hành số 123" } });
  assert.ok(t.ok);
  if (!t.ok) return;
  assert.equal(t.brand.kind, "travel");
  assert.ok(PROFILE_FIELDS.travel.some((f) => f.key === "cancel") && !PROFILE_FIELDS.retail.some((f) => f.key === "cancel"));
  assert.match(profilePrompt("La Bàn Travel", "travel", t.brand.profile), /### Giấy phép lữ hành[^\n]*\nGP lữ hành số 123[\s\S]*CHƯA CÓ THÔNG TIN[^\n]*Hủy, đổi tour/);
  assert.equal(profilePrompt("X", "retail", undefined).includes("CHƯA CÓ THÔNG TIN"), true);
  const clear = await saveBrand(s, { id: t.brand.id, name: "La Bàn Travel", channelIds: ["zt"], profile: {} });
  assert.ok(clear.ok && clear.brand.profile === undefined);
});
