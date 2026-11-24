// Bộ lọc theo chatbot ở popup Lọc của hộp thư, gồm hai ô: "KP AIbot" (chatbot nào phụ trách) và "Trạng thái chatbot" (đang làm gì với hội thoại).
// Thuần hàm, dùng được cả ở giao diện.
export type BotState = "handling" | "suggesting" | "need" | "paused" | "none";

// Trạng thái chatbot của một hội thoại:
//   handling: chatbot đang phụ trách, tự trả lời khách;  suggesting: chatbot soạn nháp, nhân viên duyệt;
//   need: chatbot đã chuyển, cần người hỗ trợ (chưa ai xử lý);  paused: có chatbot nhưng đang tạm dừng (người nhận, đã tiếp quản, hết hạn mức...);
//   none: không có chatbot nào cho hội thoại này.
// Tên trạng thái dùng chung cho bộ lọc, nút ở đầu khung chat và cột hồ sơ (một nơi duy nhất để ba chỗ luôn khớp nhau)
export const BOT_STATE_LABEL: Record<BotState, string> = { handling: "Đang phụ trách", suggesting: "Đang gợi ý", need: "Cần người hỗ trợ", paused: "Tạm dừng", none: "Không có chatbot" };
export const BOT_STATES: [string, string][] = [["all", "Tất cả"], ...(["handling", "suggesting", "need", "paused"] as BotState[]).map((k): [string, string] => [k, BOT_STATE_LABEL[k]])];
// Trạng thái ở thanh trạng thái của hội thoại (handlerStatus) đổi sang tên trạng thái chung. Nhường người (đã có nhân viên nhận hoặc vừa trả lời) cũng là Tạm dừng.
export const statusToState = (kind: "none" | "bot" | "draft" | "paused" | "handoff"): BotState => ({ none: "none", bot: "handling", draft: "suggesting", handoff: "need", paused: "paused" } as const)[kind];
export const ASSISTANT_NONE = "none";
// Loại chatbot theo giai đoạn khách: new = chốt sale cho khách mới, care = chăm sóc khách đã mua
export const ASSISTANT_KIND: Record<string, string> = { new: "Chốt sale", care: "Chăm sóc" };

export interface BotFilterItem { bot?: { id: string }; botState?: BotState }

export const matchBotState = (it: BotFilterItem, sel: string) => sel === "all" || sel === "" || (it.botState ?? "none") === sel;

// KP AIbot: tất cả, một chatbot cụ thể, hoặc chưa có chatbot nào
export const matchAssistant = (it: BotFilterItem, sel: string) => sel === "all" || sel === "" || (sel === ASSISTANT_NONE ? !it.bot : it.bot?.id === sel);

// Nhãn hệ thống do bot tự gắn khi chuyển người. Chip "cần người" ở danh sách đã báo việc này nên nhãn được ẩn khỏi danh sách và thanh nhãn.
export const HANDOFF_LABEL = "Bot: cần người";
