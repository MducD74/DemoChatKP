import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerAdapter } from "../src/core/adapter";
import { saveUpload } from "../src/core/media";
import { imageSize } from "../src/core/zalomedia";
import { cancelZaloHistory, getZaloHistoryJob, importZaloHistory } from "../src/core/zalohistory";
import { zaloPersonalAdapter } from "../src/adapters/zalo-personal";
import { channelViews, removeChannel } from "../src/core/connect";
import {
  MIN_GAP_MS, fetchZaloProfile, getFlow, listZaloGroups, resumeZaloPersonal, sendOut, sendText, setZaloGroups, startQrFlow, toEvent, zaloPersonalState, zaloSessionKey,
  type ZApi, type ZClient, type ZDeps, type ZMsg, type ZSource,
} from "../src/core/zalopersonal";
import type { DB, Store } from "../src/core/store";

registerAdapter(zaloPersonalAdapter);

const memStore = (): Store & { db: DB } => {
  const s = { db: { channels: {}, contacts: {}, conversations: {}, messages: {} } as DB,
    async load() { return structuredClone(s.db); }, async save(d: DB) { s.db = d; } };
  return s;
};

function fakeApi(ownId: string) {
  const handlers: Record<string, Array<(...a: unknown[]) => void>> = {};
  const rec = {
    sent: [] as Array<[string, string, number | undefined]>, // [chữ, mã luồng, loại luồng]
    raw: [] as Array<string | { msg: string; attachments?: ZSource | ZSource[] }>,
    started: 0, stopped: 0, userInfo: [] as string[], groupInfo: [] as string[],
    oldReq: [] as Array<[number, string | null | undefined]>,
  };
  const hooks: { old?: (type: number, lastId: string | null | undefined) => void; failSendAt?: number } = {};
  const groups: Record<string, { name?: string; avt?: string; totalMember?: number }> = { "111": { name: "Nhóm khách VIP", totalMember: 12 }, "222": { name: "Nhóm gia đình", totalMember: 4 } };
  const api: ZApi = {
    listener: {
      on(e, cb) { (handlers[e] ??= []).push(cb); return undefined; }, start() { rec.started++; }, stop() { rec.stopped++; },
      requestOldMessages(t, last) { rec.oldReq.push([t, last]); hooks.old?.(t, last); },
    },
    getOwnId: () => ownId,
    async sendMessage(m, t, ty) {
      rec.raw.push(m);
      if (hooks.failSendAt === rec.raw.length) throw new Error("mạng lỗi");
      rec.sent.push([typeof m === "string" ? m : m.msg, t, ty]);
      const id = 9000 + rec.sent.length;
      const hasAtt = typeof m !== "string" && m.attachments;
      return hasAtt ? { message: null, attachment: [{ msgId: id }] } : { message: { msgId: id } };
    },
    async getUserInfo(id) { rec.userInfo.push(id); return { changed_profiles: { [id]: { displayName: "Khách Zalo", avatar: "https://z/a.png" } } }; },
    async getAllGroups() { return { gridVerMap: Object.fromEntries(Object.keys(groups).map((k) => [k, "1"])) }; },
    async getGroupInfo(ids) { const l = ([] as string[]).concat(ids); rec.groupInfo.push(...l); return { gridInfoMap: Object.fromEntries(l.map((k) => [k, groups[k] ?? {}])) }; },
  };
  const emit = (e: string, ...a: unknown[]) => handlers[e]?.forEach((h) => h(...a));
  return { api, rec, emit, hooks };
}

// Thư viện giả: loginQR phát lần lượt các sự kiện giống thật rồi trả API; login (dùng phiên cũ) trả API hoặc lỗi
function fakeDeps(ownId: string, opts: { gate?: Promise<void>; loginError?: string } = {}) {
  const a = fakeApi(ownId);
  const logins: unknown[] = [];
  const aborts: string[] = [];
  const client: ZClient = {
    async loginQR(_o, cb) {
      const actions = { abort: () => aborts.push("abort"), retry: () => undefined };
      cb({ type: 0, data: { image: "QRBASE64" }, actions });
      await opts.gate;
      cb({ type: 2, data: { display_name: "Nhân viên A", avatar: "https://z/me.png" }, actions });
      cb({ type: 4, data: { cookie: [{ key: "zpsid", value: "SECRET-COOKIE" }], imei: "IMEI-123", userAgent: "UA" }, actions: null });
      return a.api;
    },
    async login(creds) { logins.push(creds); if (opts.loginError) throw new Error(opts.loginError); return a.api; },
  };
  const sleeps: number[] = [];
  let t = Date.now(); // bắt đầu từ giờ thật: phiên quét QR bị dọn theo giờ thật nên không được dùng mốc cố định trong quá khứ
  const deps: ZDeps = { create: async () => client, now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; }, random: () => 0 };
  return { ...a, deps, logins, aborts, sleeps, setNow: (x: number) => { t = x; }, now: () => t };
}

const until = async (f: () => boolean) => { for (let i = 0; i < 200 && !f(); i++) await new Promise((r) => setTimeout(r, 5)); assert.ok(f(), "chờ quá lâu"); };

async function connect(s: Store, ownId: string, opts: Parameters<typeof fakeDeps>[1] = {}) {
  const d = fakeDeps(ownId, opts);
  const { id } = await startQrFlow(s, {}, d.deps);
  await until(() => getFlow(id)?.status === "done");
  const flow = getFlow(id)!;
  d.emit("connected");
  return { d, id, flow };
}

const msg = (over: { type?: number; threadId?: string; isSelf?: boolean; data?: Partial<ZMsg["data"]> } = {}): ZMsg => ({
  type: 0, threadId: "CUST1", isSelf: false,
  ...over,
  data: { msgId: "m1", ts: "1700000000000", dName: "Khách A", msgType: "webchat", content: "xin chào", ...over.data },
});

test("quét QR: hiện mã, báo đã quét, tạo kênh tắt gửi, lưu phiên mã hoá", async () => {
  const s = memStore();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const d = fakeDeps("OWN-A", { gate });
  const { id } = await startQrFlow(s, {}, d.deps);
  await until(() => getFlow(id)?.status === "qr");
  assert.equal(getFlow(id)!.qr, "data:image/png;base64,QRBASE64");
  release();
  await until(() => getFlow(id)?.status === "done");
  const f = getFlow(id)!;
  assert.equal(f.name, "Nhân viên A");
  assert.equal("creds" in f, false); // không để lộ phiên ra giao diện
  const ch = s.db.channels[f.channelId!];
  assert.deepEqual([ch.kind, ch.externalId, ch.name, ch.sendEnabled], ["zalo_personal", "OWN-A", "Zalo Nhân viên A", false]);
  const blob = s.db.secrets![zaloSessionKey(ch.id)];
  assert.ok(blob);
  assert.equal(blob.includes("SECRET-COOKIE") || blob.includes("IMEI-123"), false);
  assert.equal(d.rec.started, 1);
});

test("quét lại số đã có: dùng lại kênh cũ; quét nhầm số khác thì báo lỗi", async () => {
  const s = memStore();
  const a = await connect(s, "OWN-B");
  const chId = a.flow.channelId!;
  const again = fakeDeps("OWN-B");
  const r1 = await startQrFlow(s, { expectChannelId: chId }, again.deps);
  await until(() => getFlow(r1.id)?.status === "done");
  assert.equal(getFlow(r1.id)!.channelId, chId);
  assert.equal(Object.keys(s.db.channels).length, 1);
  const other = fakeDeps("OWN-OTHER");
  const r2 = await startQrFlow(s, { expectChannelId: chId }, other.deps);
  await until(() => getFlow(r2.id)?.status === "error");
  assert.match(getFlow(r2.id)!.error!, /số Zalo khác/);
});

test("đổi tin Zalo: chat 1-1, tin tự gửi, ảnh, tệp, liên kết; bỏ nhóm và tin rỗng", () => {
  assert.deepEqual(toEvent("OWN", msg())!.message, { externalId: "m1", direction: "in", text: "xin chào", attachments: [], at: 1700000000000 });
  assert.equal(toEvent("OWN", msg())!.contact.name, "Khách A");
  const self = toEvent("OWN", msg({ isSelf: true }))!;
  assert.equal(self.message.direction, "out");
  assert.equal(self.contact.name, undefined);
  assert.equal(toEvent("OWN", msg({ type: 1 })), null); // nhóm
  assert.equal(toEvent("OWN", msg({ threadId: "OWN" })), null);
  assert.equal(toEvent("OWN", msg({ data: { content: "" } })), null);
  const photo = toEvent("OWN", msg({ data: { msgType: "chat.photo", content: { href: "https://i/1.jpg", title: "t", description: "chú thích" } } }))!;
  assert.deepEqual([photo.message.attachments, photo.message.text], [[{ type: "image", url: "https://i/1.jpg" }], "chú thích"]);
  const file = toEvent("OWN", msg({ data: { msgType: "share.file", content: { href: "https://f/a.pdf", title: "a.pdf" } } }))!;
  assert.deepEqual(file.message.attachments, [{ type: "file", url: "https://f/a.pdf", name: "a.pdf" }]);
  const link = toEvent("OWN", msg({ data: { msgType: "chat.recommended", content: { href: "https://x.vn", title: "Trang X" } } }))!;
  assert.equal(link.message.text, "Trang X https://x.vn");
  const other = toEvent("OWN", msg({ data: { msgType: "chat.location", content: { lat: 1 } } }))!;
  assert.match(other.message.text, /chưa hiển thị được/);
});

test("tin đến vào kho: khách có tên, tin tự gửi từ điện thoại lấy tên qua hồ sơ, bỏ qua nhóm", async () => {
  const s = memStore();
  const { d, flow } = await connect(s, "OWN-C");
  d.emit("message", msg({ data: { msgId: "a1" } }));
  d.emit("message", msg({ type: 1, threadId: "GROUP1", data: { msgId: "g1" } }));
  d.emit("message", msg({ threadId: "CUST2", isSelf: true, data: { msgId: "s1", content: "dạ em gửi anh" } }));
  await until(() => Object.keys(s.db.messages).length === 2 && s.db.contacts[`${flow.channelId}:CUST2`]?.name === "Khách Zalo");
  assert.equal(s.db.contacts[`${flow.channelId}:CUST1`].name, "Khách A");
  assert.equal(s.db.messages[`${flow.channelId}:s1`].direction, "out");
  assert.equal(s.db.contacts[`${flow.channelId}:CUST2`].avatarUrl, "https://z/a.png");
  assert.equal(Object.values(s.db.conversations).length, 2); // không có hội thoại nhóm
  assert.deepEqual(d.rec.userInfo.sort(), ["CUST1", "CUST2"]); // CUST1 có tên nhưng chưa có ảnh: vẫn lấy hồ sơ để có ảnh, tên giữ nguyên
});

test("rớt kết nối: bị đăng nhập nơi khác thì dừng và báo; mất mạng thì báo đang nối lại", async () => {
  const s = memStore();
  const a = await connect(s, "OWN-D");
  assert.equal(zaloPersonalState(a.flow.channelId!)!.status, "online");
  a.d.emit("closed", 3000, "duplicate");
  assert.equal(zaloPersonalState(a.flow.channelId!)!.status, "kicked");
  assert.match(zaloPersonalState(a.flow.channelId!)!.note!, /ở nơi khác/);
  const b = await connect(s, "OWN-E");
  b.d.emit("closed", 1006, "abnormal");
  assert.equal(zaloPersonalState(b.flow.channelId!)!.status, "offline");
});

test("trạng thái kênh: online là đã kết nối, bị đá là hết hạn", async () => {
  const s = memStore();
  const a = await connect(s, "OWN-F");
  let v = (await channelViews(s)).find((c) => c.id === a.flow.channelId)!;
  assert.equal(v.status, "connected");
  a.d.emit("closed", 3003, "kick");
  v = (await channelViews(s)).find((c) => c.id === a.flow.channelId)!;
  assert.equal(v.status, "expired");
  assert.match(v.note!, /ở nơi khác/);
});

test("gửi tin: chưa đăng nhập thì lỗi; giãn cách giữa các tin; hạn mức mỗi ngày; sang ngày mới được gửi lại", async () => {
  const s = memStore();
  assert.equal((await sendText({ id: "khong-co" } as never, "U", "hi")).ok, false);
  const a = await connect(s, "OWN-G");
  const ch = s.db.channels[a.flow.channelId!];
  process.env.ZALO_PERSONAL_DAILY_CAP = "3";
  try {
    const r = await Promise.all([sendText(ch, "U1", "một", a.d.deps), sendText(ch, "U1", "hai", a.d.deps), sendText(ch, "U1", "ba", a.d.deps)]);
    assert.deepEqual(r.map((x) => x.ok), [true, true, true]);
    assert.deepEqual(a.d.rec.sent.map((x) => x[0]), ["một", "hai", "ba"]); // đúng thứ tự
    assert.equal(a.d.sleeps.length, 2); // tin đầu không phải chờ
    assert.ok(a.d.sleeps.every((ms) => ms >= MIN_GAP_MS - 1));
    assert.equal(a.d.rec.sent[0][2], 0); // chat 1-1
    const over = await sendText(ch, "U1", "bốn", a.d.deps);
    assert.equal(over.ok, false);
    assert.match(over.error!, /đủ 3 tin hôm nay/);
    a.d.setNow(a.d.now() + 24 * 3600_000);
    assert.equal((await sendText(ch, "U1", "năm", a.d.deps)).ok, true);
  } finally {
    delete process.env.ZALO_PERSONAL_DAILY_CAP;
  }
});

test("adapter: không có cửa sổ trả lời, không nhận webhook, tệp chưa gửi được", async () => {
  const s = memStore();
  const a = await connect(s, "OWN-H");
  const ch = s.db.channels[a.flow.channelId!];
  assert.equal(zaloPersonalAdapter.replyWindowMs, null);
  assert.equal(zaloPersonalAdapter.verify(new Headers(), "{}"), false);
  const file = await zaloPersonalAdapter.send({ channel: ch, contactExternalId: "U", attachments: [{ type: "file", url: "https://i/x.pdf" }] });
  assert.match(file.error!, /chưa gửi được tệp/);
  const bad = await zaloPersonalAdapter.send({ channel: ch, contactExternalId: "U", attachments: [{ type: "image", url: "https://i/x.jpg" }] }); // không phải ảnh đã tải lên KP Chat
  assert.match(bad.error!, /Không đọc được ảnh/);
  assert.equal((await zaloPersonalAdapter.send({ channel: ch, contactExternalId: "U" })).ok, false);
});

test("khởi động lại: đăng nhập lại bằng phiên đã lưu (giải mã đúng)", async () => {
  const s = memStore();
  const a = await connect(s, "OWN-I");
  const chId = a.flow.channelId!;
  const ok = fakeDeps("OWN-I");
  // mô phỏng máy chủ vừa bật: chưa có phiên trong bộ nhớ
  await resumeZaloPersonal(s, ok.deps, 0);
  assert.equal(ok.logins.length, 1);
  assert.equal((ok.logins[0] as { imei: string }).imei, "IMEI-123"); // đã giải mã đúng
  ok.emit("connected");
  assert.equal(zaloPersonalState(chId)!.status, "online");
  assert.equal(ok.rec.started, 1);
});

test("gỡ kênh: ngắt phiên đang nghe và xoá khoá phiên", async () => {
  const s = memStore();
  const a = await connect(s, "OWN-J");
  const chId = a.flow.channelId!;
  assert.ok(s.db.secrets![zaloSessionKey(chId)]);
  await removeChannel(s, chId);
  assert.equal(a.d.rec.stopped, 1);
  assert.equal(zaloPersonalState(chId), null);
  assert.equal(s.db.secrets![zaloSessionKey(chId)], undefined);
});

// ---------- Gửi ảnh ----------
// PNG 1x1 nhỏ nhất và JPEG tối thiểu có khối SOF0 (chỉ cần phần đầu để đo kích thước)
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEUlEQVR4nGNgYGD4z8DAwAAAAAkAAbCexAcAAAAASUVORK5CYII=", "base64");
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x10, 0x00, 0x20, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9]);
const img = (n: string): ZSource => ({ data: Buffer.from("x"), filename: `${n}.png`, metadata: { totalSize: 1, width: 1, height: 1 } });

test("đo kích thước ảnh png và jpg từ phần đầu tệp", () => {
  assert.deepEqual(imageSize(PNG), { width: 3, height: 2 });
  assert.deepEqual(imageSize(JPG), { width: 32, height: 16 });
  assert.equal(imageSize(Buffer.from("không phải ảnh")), null);
});

test("gửi ảnh: một ảnh kèm chữ là một tin; nhiều ảnh thì chữ trước, ảnh cùng một lượt; tính hạn mức theo số tin", async () => {
  const s = memStore();
  const a = await connect(s, "OWN-IMG");
  const ch = s.db.channels[a.flow.channelId!];
  const one = await sendOut(ch, "U9", { text: "ảnh sản phẩm", images: [img("a")] }, a.d.deps);
  assert.deepEqual([one.ok, one.externalId], [true, "9001"]); // mã tin lấy từ danh sách tệp đính kèm
  assert.equal(a.d.rec.raw.length, 1);
  const first = a.d.rec.raw[0] as { msg: string; attachments: ZSource[] };
  assert.equal(first.msg, "ảnh sản phẩm");
  assert.equal(first.attachments.length, 1);
  const many = await sendOut(ch, "U9", { text: "ba ảnh", images: [img("b"), img("c"), img("d")] }, a.d.deps);
  assert.equal(many.ok, true);
  assert.equal(a.d.rec.raw.length, 3); // 1 + chữ + một lượt ba ảnh
  assert.equal(a.d.rec.raw[1], "ba ảnh");
  assert.equal(((a.d.rec.raw[2] as { attachments: ZSource[] }).attachments).length, 3);
  assert.equal(a.d.sleeps.length, 2); // giãn cách giữa ba lần gọi
  // hạn mức: đã gửi 1 + 4 = 5 tin; hạn mức 6 thì gửi 2 ảnh nữa không đủ chỗ
  process.env.ZALO_PERSONAL_DAILY_CAP = "6";
  try {
    const over = await sendOut(ch, "U9", { images: [img("e"), img("f")] }, a.d.deps);
    assert.equal(over.ok, false);
    assert.match(over.error!, /5\/6 tin/);
    assert.equal(a.d.rec.raw.length, 3); // không gửi nửa chừng
  } finally { delete process.env.ZALO_PERSONAL_DAILY_CAP; }
  assert.equal((await sendOut(ch, "U9", { images: [img("1"), img("2"), img("3"), img("4"), img("5"), img("6")] }, a.d.deps)).ok, false); // quá 5 ảnh
  assert.equal((await sendOut(ch, "U9", {}, a.d.deps)).ok, false);
});

test("gửi ảnh: lỗi giữa chừng báo phần chữ đã gửi; gửi vào nhóm dùng loại luồng nhóm", async () => {
  const s = memStore();
  const a = await connect(s, "OWN-ERR");
  const ch = s.db.channels[a.flow.channelId!];
  a.d.hooks.failSendAt = 2;
  const r = await sendOut(ch, "U1", { text: "chữ", images: [img("a"), img("b")] }, a.d.deps);
  assert.equal(r.ok, false);
  assert.match(r.error!, /mạng lỗi.*Phần chữ đã gửi/);
  assert.equal(r.externalId, "9001"); // tin chữ đã đi
  const g = await sendOut(ch, "g:777", { text: "chào nhóm" }, a.d.deps);
  assert.equal(g.ok, true);
  assert.deepEqual(a.d.rec.sent.at(-1), ["chào nhóm", "777", 1]); // bỏ tiền tố g:, loại 1 = nhóm
});

test("adapter gửi ảnh: chỉ đọc ảnh đã tải lên KP Chat, đo kích thước, gửi byte (không tải địa chỉ ngoài)", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kpchat-zmedia-"));
  process.env.KPCHAT_MEDIA_DIR = dir;
  try {
    const up = await saveUpload(PNG, "image/png");
    assert.ok(up.ok);
    const s = memStore();
    const a = await connect(s, "OWN-UP");
    const ch = s.db.channels[a.flow.channelId!];
    const r = await zaloPersonalAdapter.send({ channel: ch, contactExternalId: "U5", text: "đây ạ", attachments: [{ type: "image", url: `https://kp.example/api/media/${up.id}` }] });
    assert.equal(r.ok, true);
    const sent = a.d.rec.raw[0] as { msg: string; attachments: ZSource[] };
    assert.equal(sent.msg, "đây ạ");
    assert.deepEqual([sent.attachments[0].metadata.width, sent.attachments[0].metadata.height, sent.attachments[0].metadata.totalSize], [3, 2, PNG.length]);
    assert.ok(Buffer.isBuffer(sent.attachments[0].data) && sent.attachments[0].data.equals(PNG));
    assert.equal(sent.attachments[0].filename, up.id);
    // mã lạ (thoát đường dẫn) bị từ chối
    const evil = await zaloPersonalAdapter.send({ channel: ch, contactExternalId: "U5", attachments: [{ type: "image", url: "https://kp.example/api/media/..%2F..%2Fchat.json" }] });
    assert.equal(evil.ok, false);
    assert.equal(a.d.rec.raw.length, 1);
  } finally { delete process.env.KPCHAT_MEDIA_DIR; }
});

// ---------- Nhóm chat ----------
test("nhóm chat: mặc định tắt; bật thì vào hộp thư với mã g:, ghi rõ người nói, tên nhóm lấy qua hồ sơ", async () => {
  const s = memStore();
  const { d, flow } = await connect(s, "OWN-GRP");
  const gmsg = (id: string, over: Partial<ZMsg["data"]> = {}, self = false): ZMsg => msg({ type: 1, threadId: "111", isSelf: self, data: { msgId: id, dName: "Chị Lan", content: "giá bao nhiêu vậy", ...over } });
  assert.equal(toEvent("OWN-GRP", gmsg("x")), null); // không truyền danh sách nhóm: bỏ
  d.emit("message", gmsg("g0"));
  d.emit("message", msg({ data: { msgId: "u0" } }));
  await until(() => Object.keys(s.db.messages).length === 1);
  assert.equal(Object.values(s.db.conversations).length, 1); // nhóm tắt thì không có hội thoại nhóm
  assert.equal((await setZaloGroups(s, flow.channelId!, ["111"])).ok, true);
  assert.equal(s.db.channels[flow.channelId!].meta?.groups, "111");
  d.emit("message", gmsg("g1"));
  d.emit("message", gmsg("g2", { content: "dạ em báo giá ngay" }, true));
  d.emit("message", { ...gmsg("g3"), threadId: "222" }); // nhóm khác vẫn tắt
  await until(() => s.db.contacts[`${flow.channelId}:g:111`]?.name === "Nhóm khách VIP" && !!s.db.messages[`${flow.channelId}:g2`]);
  assert.equal(s.db.messages[`${flow.channelId}:g1`].text, "Chị Lan: giá bao nhiêu vậy");
  assert.equal(s.db.messages[`${flow.channelId}:g1`].direction, "in");
  assert.equal(s.db.messages[`${flow.channelId}:g2`].text, "dạ em báo giá ngay"); // tin mình gửi không thêm tên
  assert.equal(s.db.messages[`${flow.channelId}:g2`].direction, "out");
  assert.equal(s.db.messages[`${flow.channelId}:g3`], undefined);
  assert.ok(d.rec.groupInfo.length >= 1 && d.rec.groupInfo.every((x) => x === "111"));
  // tắt lại thì ngừng nhận ngay, không cần nối lại
  await setZaloGroups(s, flow.channelId!, []);
  assert.equal(s.db.channels[flow.channelId!].meta, undefined);
  d.emit("message", gmsg("g4"));
  d.emit("message", msg({ data: { msgId: "u1" } }));
  await until(() => !!s.db.messages[`${flow.channelId}:u1`]);
  assert.equal(s.db.messages[`${flow.channelId}:g4`], undefined);
  const ch = s.db.channels[flow.channelId!];
  assert.equal((await fetchZaloProfile(ch, "g:111"))!.name, "Nhóm khách VIP");
});

test("nhóm chat: danh sách có trạng thái bật, kiểm mã nhóm và giới hạn, kênh không phải Zalo cá nhân bị từ chối", async () => {
  const s = memStore();
  const { flow } = await connect(s, "OWN-LST");
  const ch = s.db.channels[flow.channelId!];
  await setZaloGroups(s, ch.id, ["222", "999"]);
  const r = await listZaloGroups(s.db.channels[ch.id]);
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.groups.map((g) => [g.id, g.enabled]).sort(), [["111", false], ["222", true], ["999", true]]);
    assert.match(r.groups.find((g) => g.id === "999")!.name, /không còn/); // đã rời nhóm nhưng vẫn tắt được
  }
  assert.equal((await setZaloGroups(s, ch.id, ["abc"])).ok, false);
  assert.equal((await setZaloGroups(s, ch.id, Array.from({ length: 201 }, (_, i) => String(i)))).ok, false);
  s.db.channels["fb1"] = { id: "fb1", companyId: "default", kind: "facebook", externalId: "P", name: "FB", sendEnabled: false };
  assert.equal((await setZaloGroups(s, "fb1", ["1"])).ok, false);
  assert.equal((await listZaloGroups({ id: "chua-dang-nhap" } as never)).ok, false);
});

// ---------- Tải tin cũ ----------
const old = (id: string, ts: number, over: Partial<ZMsg> = {}): ZMsg => msg({ threadId: "OLD1", data: { msgId: id, ts: String(ts), content: `tin ${id}` }, ...over });

test("tải tin cũ: lùi từng lô theo mã tin cũ nhất, tin vào ở chế độ lịch sử, dừng khi hết, chạy lại không trùng", async () => {
  const s = memStore();
  const { d, flow } = await connect(s, "OWN-OLD");
  const ch = s.db.channels[flow.channelId!];
  const now = 1_700_000_000_000;
  const DAY = 86_400_000;
  const pages: Record<string, ZMsg[]> = {
    "": [old("p3", now - 1 * DAY), old("p2", now - 2 * DAY, { isSelf: true }), old("p1", now - 3 * DAY)],
    p1: [old("o3", now - 10 * DAY), old("o2", now - 11 * DAY)],
    o2: [], // hết
  };
  d.hooks.old = (type, last) => setTimeout(() => d.emit("old_messages", pages[last ?? ""] ?? [], type), 0);
  const job = await importZaloHistory(s, ch, { days: 0, pauseMs: 0, now, pageTimeoutMs: 500 });
  assert.equal(job.status, "done");
  assert.deepEqual([job.stored, job.duplicates, job.conversations], [5, 0, 1]);
  assert.deepEqual(d.rec.oldReq, [[0, null], [0, "p1"], [0, "o2"]]);
  const conv = Object.values(s.db.conversations)[0];
  assert.equal(conv.status, "resolved");
  assert.equal(conv.lastInboundHistory, true);
  assert.ok(Object.values(s.db.messages).every((m) => m.history === true));
  assert.equal(s.db.messages[`${ch.id}:p2`].direction, "out");
  assert.equal(s.db.contacts[`${ch.id}:OLD1`].name, "Khách A"); // tên lấy từ tin của khách
  assert.equal(getZaloHistoryJob(ch.id)!.status, "done");
  const again = await importZaloHistory(s, ch, { days: 0, pauseMs: 0, now, pageTimeoutMs: 500 });
  assert.deepEqual([again.stored, again.duplicates], [0, 5]);
});

test("tải tin cũ: giới hạn theo số ngày; lô không cũ hơn lô trước thì dừng (không lặp vô hạn); đủ tên khách qua hồ sơ", async () => {
  const s = memStore();
  const { d, flow } = await connect(s, "OWN-DAYS");
  const ch = s.db.channels[flow.channelId!];
  const now = 1_700_000_000_000;
  const DAY = 86_400_000;
  // khách chỉ có tin tự gửi (chưa biết tên) -> sau khi tải lấy tên qua getUserInfo
  d.hooks.old = (type, last) => setTimeout(() => d.emit("old_messages", last === null || last === undefined
    ? [old("a1", now - 2 * DAY, { threadId: "NONAME", isSelf: true }), old("a0", now - 40 * DAY, { threadId: "NONAME", isSelf: true })]
    : [old("a1", now - 2 * DAY, { threadId: "NONAME", isSelf: true })], type), 0); // lô sau lặp lại tin cũ
  const job = await importZaloHistory(s, ch, { days: 30, pauseMs: 0, now, pageTimeoutMs: 500 });
  assert.equal(job.status, "done");
  assert.equal(job.stored, 1); // tin 40 ngày trước bị bỏ
  assert.equal(d.rec.oldReq.length, 1); // lô đầu đã chạm mốc ngày nên không xin thêm
  await until(() => s.db.contacts[`${ch.id}:NONAME`]?.name === "Khách Zalo");
  // lô lặp: dừng ở lần xin thứ hai
  const s2 = memStore();
  const b = await connect(s2, "OWN-LOOP");
  const ch2 = s2.db.channels[b.flow.channelId!];
  b.d.hooks.old = (type) => setTimeout(() => b.d.emit("old_messages", [old("l1", now - 3 * DAY)], type), 0);
  const j2 = await importZaloHistory(s2, ch2, { days: 0, pauseMs: 0, now, pageTimeoutMs: 500 });
  assert.equal(j2.status, "done");
  assert.equal(b.d.rec.oldReq.length, 2);
});

test("tải tin cũ: nhóm chỉ vào khi nhóm được bật; không phản hồi thì báo lỗi; dừng giữa chừng; chưa đăng nhập thì báo", async () => {
  const s = memStore();
  const { d, flow } = await connect(s, "OWN-HG");
  const ch = s.db.channels[flow.channelId!];
  const now = 1_700_000_000_000;
  const gm = (id: string, gid: string): ZMsg => msg({ type: 1, threadId: gid, data: { msgId: id, ts: String(now - 1000), dName: "Anh Bình", content: `nhóm ${id}` } });
  d.hooks.old = (type) => setTimeout(() => d.emit("old_messages", type === 0 ? [old("u1", now - 1000)] : [gm("n1", "111"), gm("n2", "222")], type), 0);
  await setZaloGroups(s, ch.id, ["111"]);
  const job = await importZaloHistory(s, s.db.channels[ch.id], { days: 0, pauseMs: 0, now, pageTimeoutMs: 500 });
  assert.equal(job.status, "done");
  assert.deepEqual(d.rec.oldReq.map((x) => x[0]), [0, 0, 1, 1]); // mỗi loại: một lô rồi lô lặp (không cũ hơn) nên dừng
  assert.ok(s.db.messages[`${ch.id}:n1`]);
  assert.equal(s.db.messages[`${ch.id}:n2`], undefined); // nhóm 222 chưa bật
  assert.equal(s.db.messages[`${ch.id}:n1`].text, "Anh Bình: nhóm n1");
  // không phản hồi
  const s3 = memStore();
  const c = await connect(s3, "OWN-TO");
  const j3 = await importZaloHistory(s3, s3.db.channels[c.flow.channelId!], { days: 0, pauseMs: 0, pageTimeoutMs: 30 });
  assert.equal(j3.status, "error");
  assert.match(j3.error!, /không trả tin cũ/);
  // dừng giữa chừng
  const s4 = memStore();
  const e = await connect(s4, "OWN-STOP");
  const ch4 = s4.db.channels[e.flow.channelId!];
  let n = 0;
  e.d.hooks.old = (type) => setTimeout(() => { n++; if (n === 1) cancelZaloHistory(ch4.id); e.d.emit("old_messages", [old(`s${n}`, now - n * 1000)], type); }, 0);
  const j4 = await importZaloHistory(s4, ch4, { days: 0, pauseMs: 0, now, pageTimeoutMs: 500 });
  assert.equal(j4.status, "stopped");
  assert.equal(e.d.rec.oldReq.length, 1);
  // chưa đăng nhập
  const j5 = await importZaloHistory(s4, { ...ch4, id: "khong-dang-nhap" }, { days: 0, pauseMs: 0 });
  assert.equal(j5.status, "error");
  assert.match(j5.error!, /chưa đăng nhập/);
});
