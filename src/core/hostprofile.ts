// Hồ sơ khách từ các hệ thống nối ngoài, theo đúng thứ KP Chat 1 hiện ở cột phải: lead KP CRM (giai đoạn, việc tiếp), trạng thái chăm sóc,
// khách KiotViet và lịch sử đơn hàng từ POS. Đây là "cổng" để khi nối vào KPF thì thay hàm hostProfile bằng hàm gọi KPF
// (crmProfile, đơn hàng POS); giao diện không đổi. Bản chạy riêng chưa nối: lead là giai đoạn lưu ngay trong hội thoại, chưa có khách KiotViet và đơn hàng.
import type { Contact, Conversation } from "./types";
import { stageOf } from "./convmeta";

export interface HostProfile {
  linked: { crm: boolean; pos: boolean }; // đã nối KP CRM và POS chưa (để giao diện báo đúng lý do khi trống)
  lead?: { id: string; stage: string; stageName: string; core: string; nextAction?: string; nextDue?: string; href?: string };
  custStatus?: string; // trạng thái chăm sóc khách ở KP CRM
  kov?: { id: string; code: string; name: string; href?: string }; // khách KiotViet khớp theo số điện thoại
  buys?: { invoices: { code: string; at: string; total: number }[]; mix: { name: string; pct: number }[] };
}

export function hostProfile(conv: Conversation, _contact: Contact): HostProfile {
  void _contact;
  const stage = stageOf(conv.stage);
  const next = (conv.tasks ?? []).filter((t) => !t.done).sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"))[0];
  return {
    linked: { crm: false, pos: false },
    lead: stage ? { id: conv.id, stage: stage.key, stageName: stage.name, core: stage.core, nextAction: next?.text, nextDue: next?.due } : undefined,
  };
}
