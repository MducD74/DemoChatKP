// Phần của Nhật ký dùng được ở giao diện (không nạp kho dữ liệu). Xem audit.ts cho phần ghi và đọc.
export interface AuditRow { at: number; uid: string; who: string; action: string; target?: string }
export const DENIED = "Bị từ chối";
