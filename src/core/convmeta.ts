// Thang trạng thái (giai đoạn tư vấn) của hội thoại, giống thang của KP CRM (Mới, Quan tâm, Tiềm năng, Gần chốt, Chuyển đổi, Mất/Spam)
// để khi nối KPF thì ánh xạ một-một. Hiện giữ riêng trong KP Chat 2.0. Thuần hàm, dùng được cả ở giao diện.
export type StageCore = "new" | "interest" | "potential" | "near" | "won" | "lost";
export interface Stage { key: string; name: string; core: StageCore }
export const STAGES: Stage[] = [
  { key: "new", name: "Mới", core: "new" },
  { key: "interest", name: "Quan tâm", core: "interest" },
  { key: "potential", name: "Tiềm năng", core: "potential" },
  { key: "near", name: "Gần chốt", core: "near" },
  { key: "won", name: "Chuyển đổi", core: "won" },
  { key: "lost", name: "Mất/Spam", core: "lost" },
];
export const LOST_REASONS = ["Giá chưa phù hợp", "Đã mua nơi khác", "Sản phẩm chưa phù hợp", "Tư vấn chưa tốt hoặc trả lời chậm", "Không phản hồi", "Spam"];
export const stageOf = (key?: string) => STAGES.find((s) => s.key === key);
export const TASK_LIMITS = { text: 200, note: 200, perConv: 50, log: 100 };
export const PRIORITY: [string, string][] = [["low", "Thấp"], ["med", "Trung bình"], ["high", "Cao"]];

// Mỗi giai đoạn khách có một chatbot riêng: chốt sale lo từ khách mới tới gần chốt, chăm sóc lo khách đã mua (Chuyển đổi). Mất/Spam không giao cho trợ lý nào.
export const DEFAULT_BOT_STAGES: Record<"new" | "care", string[]> = { new: ["new", "interest", "potential", "near"], care: ["won"] };
export const botStages = (b: { type: "new" | "care"; stages?: string[] }): string[] => b.stages ?? DEFAULT_BOT_STAGES[b.type];
