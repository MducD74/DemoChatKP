// Thư viện kịch bản của chatbot: hai thư viện, "Kịch bản chốt sale" (khách mới) và "Chăm sóc khách hàng" (khách cũ).
// Kho kịch bản mẫu (không có botId) để quản trị xem, sửa, thêm. Kịch bản RIÊNG của một chatbot (có botId, sao từ kho mẫu hoặc tự viết)
// được đưa vào lời nhắc của chatbot đó (xem scriptsPrompt); sửa bản riêng không đổi kho mẫu.
// File này không có đường gửi tin.
import { mutate, type DB, type Store } from "./store";
import type { BotState } from "./chatbot";

export type ScriptLib = "sale" | "care";
// seed: mã của kịch bản mẫu có sẵn (để biết kịch bản nào do hệ thống nạp). Người dùng sửa hoặc xóa đều được.
// botId: kịch bản riêng của chatbot này (trống = kho mẫu). from: mã kịch bản mẫu đã sao ra bản riêng.
export interface Script { id: string; lib: ScriptLib; title: string; when: string; body: string; at: number; seed?: string; botId?: string; from?: string }

export const SCRIPT_LIBS: [ScriptLib, string, string][] = [
  ["sale", "Kịch bản chốt sale", "Khách mới: chào, hiểu nhu cầu, báo giá, xin số điện thoại, xử lý chê đắt, chốt đơn, chuyển người khi cần."],
  ["care", "Chăm sóc khách hàng", "Khách cũ: hỏi thăm sau giao hàng, nhắc mua lại, khách quay lại hỏi, xử lý phàn nàn."],
];
export const SCRIPT_LIMITS = { count: 100, perBot: 20, title: 80, when: 200, body: 3000, prompt: 8000 };

const state = (db: DB): BotState => (db.bot ??= { settings: { docs: [] }, bots: {}, drafts: {} });
// Kho mẫu (không tính kịch bản riêng của chatbot).
export const scriptList = (db: DB, lib?: ScriptLib): Script[] => (db.bot?.scripts ?? []).filter((s) => !s.botId && (!lib || s.lib === lib));
export const botScripts = (db: DB, botId: string): Script[] => (db.bot?.scripts ?? []).filter((s) => s.botId === botId);

// Phần đưa vào lời nhắc: các kịch bản riêng của chatbot, cắt theo giới hạn chữ. Rỗng nếu chatbot chưa có kịch bản nào.
export function scriptsPrompt(list: Script[]): string {
  const out: string[] = [];
  let n = 0;
  for (const s of list) {
    const block = `### ${s.title}${s.when ? ` (khi: ${s.when})` : ""}\n${s.body}`;
    if ((n += block.length + 2) > SCRIPT_LIMITS.prompt) break;
    out.push(block);
  }
  return out.length ? `KỊCH BẢN TƯ VẤN CỦA CHATBOT NÀY (quản trị đã duyệt; làm theo tinh thần khi đúng tình huống, không chép máy móc. K là khách, B là mẫu lời chatbot. Chỗ trong [ ] chỉ điền bằng thông tin có trong KIẾN THỨC, không có thì không bịa. Kịch bản không vượt quá các quy tắc bắt buộc ở trên):\n${out.join("\n\n")}` : "";
}

type Seed = { key: string; lib: ScriptLib; title: string; when: string; body: string };
// Lời mẫu để dạng chung, sửa theo giọng từng thương hiệu. [ ... ] là chỗ điền theo thương hiệu. K là khách, B là bot.
export const SEED_SCRIPTS: Seed[] = [
  { key: "sale-chao", lib: "sale", title: "Khách mới chào hỏi", when: "Khách nhắn lần đầu, chỉ chào hoặc hỏi chung chung",
    body: "K: Shop ơi\nB: Dạ em chào anh/chị, em là trợ lý của [Thương hiệu]. Anh/chị đang quan tâm món nào để em tư vấn ạ?\n\nNguyên tắc: chào ngắn, hỏi một câu mở. Không gửi danh sách dài ngay." },
  { key: "sale-gia", lib: "sale", title: "Khách hỏi giá", when: "Khách hỏi giá một món",
    body: "K: Món này giá bao nhiêu?\nB: Dạ [món] bên em [giá] / [đơn vị] ạ. Anh/chị dùng cho mấy người để em gợi ý phần vừa đủ nhé?\n\nNguyên tắc: trả lời giá trước, rồi hỏi thêm nhu cầu. Không có giá trong tài liệu thì nói sẽ nhờ nhân viên báo, không đoán." },
  { key: "sale-tonkho", lib: "sale", title: "Khách hỏi còn hàng không", when: "Khách hỏi tồn kho khi chưa nối KP Shop",
    body: "K: Hôm nay còn không?\nB: Dạ để chắc chắn em nhờ nhân viên kiểm tra tồn kho cho mình ngay nhé. Anh/chị cho em xin số điện thoại để nhân viên báo lại nhanh ạ.\n\nNguyên tắc: chưa nối tồn kho thì không khẳng định còn hàng. Sau khi nối KP Shop sẽ đổi kịch bản này." },
  { key: "sale-sdt", lib: "sale", title: "Xin số điện thoại đúng lúc", when: "Khách đã quan tâm cụ thể (hỏi giá, hỏi giao hàng, muốn đặt)",
    body: "B: Anh/chị để lại số điện thoại để nhân viên gọi xác nhận và giữ hàng giúp mình nhé ạ.\n\nNguyên tắc: xin một lần, nói rõ để làm gì. Khách từ chối thì thôi, không nài, tiếp tục tư vấn." },
  { key: "sale-dat", lib: "sale", title: "Khách chê đắt", when: "Khách phản đối về giá",
    body: "K: Sao đắt vậy?\nB: Dạ em hiểu ạ. Bên em [lý do giá: nguồn gốc, chất lượng, độ tươi]. Nếu anh/chị muốn tiết kiệm, em gợi ý [phần nhỏ hơn hoặc combo] ạ.\n\nNguyên tắc: không tranh cãi, không tự giảm giá. Khách đòi giảm thì chuyển nhân viên." },
  { key: "sale-sosanh", lib: "sale", title: "Khách so sánh với nơi khác", when: "Khách nói nơi khác rẻ hơn hoặc hỏi khác gì nơi khác",
    body: "B: Dạ mỗi nơi một thế mạnh ạ. Điểm bên em là [điểm khác biệt]. Anh/chị cần gì nhất để em tư vấn đúng nhé?\n\nNguyên tắc: không chê đối thủ, không nêu số liệu không có trong tài liệu." },
  { key: "sale-cheo", lib: "sale", title: "Khách hỏi món của thương hiệu khác trong Labancorp", when: "Khách hỏi món shop này không bán nhưng thương hiệu khác trong hệ thống có bán",
    body: "K: Bên mình có bán thịt heo không?\nB: Dạ phần đó bên [thương hiệu khác] trong cùng hệ thống bán ạ, anh/chị xem tại [link]. Em vẫn ở đây tư vấn tiếp phần [món của shop này] cho mình nhé.\n\nNguyên tắc: giới thiệu thương hiệu kia kèm link và gắn nhãn để đo. Cần danh bạ link các thương hiệu trong Labancorp." },
  { key: "sale-chot", lib: "sale", title: "Chốt đơn", when: "Khách đã chọn món và muốn đặt",
    body: "B: Em xác nhận lại giúp mình: [món, số lượng], giao đến [địa chỉ], nhận [ngày giờ]. Anh/chị cho em tên và số điện thoại người nhận để nhân viên chốt đơn ạ.\n\nNguyên tắc: bot gom thông tin, không tự xác nhận đơn và không nhận tiền. Chuyển nhân viên hoàn tất." },
  { key: "sale-phannan", lib: "sale", title: "Khách phàn nàn (bắt buộc chuyển người)", when: "Khách giận, đơn giao sai, chất lượng không tốt",
    body: "K: Đơn hôm qua giao sai, tôi rất bực.\nB: Dạ em xin lỗi anh/chị vì trải nghiệm chưa tốt ạ. Em chuyển ngay cho nhân viên xử lý đơn này, anh/chị cho em mã đơn hoặc số điện thoại đặt hàng để nhân viên tìm nhanh ạ.\n\nNguyên tắc: xin lỗi trước, không giải thích dài, không hứa đền bù, chuyển người ngay." },
  { key: "sale-gapnguoi", lib: "sale", title: "Khách đòi gặp người thật hoặc hoàn tiền", when: "Khách nhắn gặp nhân viên, hoàn tiền, khiếu nại",
    body: "B: Dạ em chuyển anh/chị cho nhân viên hỗ trợ ngay ạ, mình đợi chút nhé.\n\nNguyên tắc: không giữ khách lại, chuyển người ngay." },
  { key: "sale-ngoai", lib: "sale", title: "Câu hỏi ngoài phạm vi", when: "Khách hỏi chuyện không liên quan sản phẩm của shop",
    body: "K: Cho hỏi thời tiết ngày mai?\nB: Dạ phần này em chưa hỗ trợ được ạ. Em tư vấn được về [sản phẩm, đơn hàng, giao hàng], anh/chị cần gì cứ nhắn em nhé.\n\nNguyên tắc: nói rõ phạm vi, không chuyển người vô cớ." },
  { key: "sale-khongbiet", lib: "sale", title: "Bot không biết câu trả lời", when: "Câu hỏi liên quan shop nhưng tài liệu không có thông tin",
    body: "B: Phần này em chưa có thông tin chính xác ạ. Em nhờ nhân viên trả lời giúp mình, anh/chị đợi chút nhé.\n\nNguyên tắc: nói thật là không chắc, không bịa. Chuyển người nếu liên quan đơn hàng cụ thể." },
  { key: "sale-nhacnhe", lib: "sale", title: "Nhắc nhẹ khi khách im sau khi hỏi giá", when: "Khách hỏi giá rồi im lặng khoảng một ngày",
    body: "B (sau 1 ngày): Dạ hôm qua mình có hỏi [món], anh/chị cần em hỗ trợ thêm gì không ạ?\n\nNguyên tắc: nhắc một lần, trong khung thời gian cho phép của kênh. Không gửi quá cửa sổ trả lời của kênh." },
  { key: "care-hoithamsau", lib: "care", title: "Hỏi thăm sau khi nhận hàng", when: "Vài ngày sau khi khách nhận đơn",
    body: "B: Dạ [Tên], hôm trước anh/chị nhận [món] có hài lòng không ạ? Có điều gì chưa ưng, em báo nhân viên hỗ trợ ngay.\n\nNguyên tắc: nếu khách chê, xin lỗi ngắn và chuyển người." },
  { key: "care-muala", lib: "care", title: "Nhắc mua lại", when: "Khi đến chu kỳ dùng hết sản phẩm",
    body: "B: Dạ [Tên], mình dùng [món] được [thời gian] rồi, em nhắc nhẹ nếu anh/chị cần đặt thêm. Tuần này bên em có [khuyến mãi nếu đang chạy] ạ.\n\nNguyên tắc: chỉ nhắc theo chu kỳ hợp lý của sản phẩm, một lần, không dồn dập." },
  { key: "care-quaylai", lib: "care", title: "Khách cũ quay lại hỏi", when: "Khách đã mua trước đây nhắn lại sau hơn 7 ngày",
    body: "B: Dạ [Tên], lâu rồi mới thấy anh/chị nhắn, em giúp được gì cho mình ạ?\n\nNguyên tắc: dùng lịch sử hội thoại và tên khách, không hỏi lại điều khách đã nói." },
  { key: "care-phannan", lib: "care", title: "Khách cũ phàn nàn", when: "Khách đã mua báo vấn đề về đơn cũ",
    body: "B: Dạ em xin lỗi anh/chị về việc này ạ. Em chuyển ngay cho nhân viên xử lý, anh/chị cho em mã đơn hoặc số điện thoại đặt hàng để nhân viên tìm nhanh nhé.\n\nNguyên tắc: xin lỗi ngắn, không hứa đền bù hay hoàn tiền, chuyển người ngay." },
];

// Nạp kịch bản mẫu một lần: chỉ khi thư viện chưa từng được tạo (db.bot.scripts chưa có). Sau đó xóa hết cũng không nạp lại.
export function seedScripts(now = Date.now()): Script[] {
  return SEED_SCRIPTS.map((s, i) => ({ id: `scr-${s.key}`, lib: s.lib, title: s.title, when: s.when, body: s.body, at: now + i, seed: s.key }));
}
export async function ensureScripts(store: Store): Promise<void> {
  const db = await store.load();
  if (db.bot?.scripts) return;
  await mutate(store, (d) => { const st = state(d); if (!st.scripts) st.scripts = seedScripts(); });
}

type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export interface ScriptInput { id?: unknown; lib?: unknown; title?: unknown; when?: unknown; body?: unknown; botId?: unknown; from?: unknown }

// Tạo hoặc sửa một kịch bản (có id thì sửa; không đổi được thư viện hay chatbot của kịch bản đã có).
// Có botId là kịch bản riêng của chatbot đó (tối đa perBot); from là mã kịch bản mẫu được sao.
export async function saveScript(store: Store, input: ScriptInput, now = Date.now()): Promise<Res<{ script: Script }>> {
  return mutate(store, (db): Res<{ script: Script }> => {
    const st = state(db);
    const list = (st.scripts ??= []);
    const old = typeof input.id === "string" && input.id ? list.find((s) => s.id === input.id) : undefined;
    if (input.id && !old) return { ok: false, error: "Không thấy kịch bản" };
    const lib = old?.lib ?? input.lib;
    if (lib !== "sale" && lib !== "care") return { ok: false, error: "Thư viện kịch bản không hợp lệ" };
    const title = String(input.title ?? "").trim();
    if (!title || title.length > SCRIPT_LIMITS.title) return { ok: false, error: `Tên kịch bản từ 1 đến ${SCRIPT_LIMITS.title} ký tự` };
    const when = String(input.when ?? "").trim();
    if (when.length > SCRIPT_LIMITS.when) return { ok: false, error: `Tình huống tối đa ${SCRIPT_LIMITS.when} ký tự` };
    const body = String(input.body ?? "").trim();
    if (!body || body.length > SCRIPT_LIMITS.body) return { ok: false, error: `Nội dung kịch bản từ 1 đến ${SCRIPT_LIMITS.body} ký tự` };
    const botId = old ? old.botId : typeof input.botId === "string" && input.botId ? input.botId : undefined;
    if (botId && !db.bot?.bots?.[botId]) return { ok: false, error: "Không thấy chatbot" };
    const scope = list.filter((s) => (s.botId ?? "") === (botId ?? ""));
    if (!old && botId && scope.length >= SCRIPT_LIMITS.perBot) return { ok: false, error: `Mỗi chatbot có tối đa ${SCRIPT_LIMITS.perBot} kịch bản riêng` };
    if (!old && !botId && scope.length >= SCRIPT_LIMITS.count) return { ok: false, error: `Tối đa ${SCRIPT_LIMITS.count} kịch bản` };
    if (scope.some((s) => s.id !== old?.id && s.lib === lib && s.title.toLowerCase() === title.toLowerCase())) return { ok: false, error: botId ? "Chatbot này đã có kịch bản trùng tên" : "Thư viện này đã có kịch bản trùng tên" };
    const from = old ? old.from : botId && typeof input.from === "string" && list.some((s) => s.id === input.from && !s.botId) ? input.from : undefined;
    const script: Script = { id: old?.id ?? `scr-${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, lib, title, when, body, at: old && old.title === title && old.when === when && old.body === body ? old.at : now, ...(old?.seed ? { seed: old.seed } : {}), ...(botId ? { botId } : {}), ...(from ? { from } : {}) };
    if (old) list[list.indexOf(old)] = script;
    else list.push(script);
    return { ok: true, script };
  });
}

export async function deleteScript(store: Store, id: string): Promise<Res> {
  return mutate(store, (db): Res => {
    const list = db.bot?.scripts;
    const i = list ? list.findIndex((s) => s.id === id) : -1;
    if (!list || i < 0) return { ok: false, error: "Không thấy kịch bản" };
    list.splice(i, 1);
    return { ok: true };
  });
}
