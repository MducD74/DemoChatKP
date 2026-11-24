// Giao diện host: mỗi KPF (LBF, KP Travel, KPF AI) viết một bản nối vào hệ của mình.
// Lõi KP Chat không import trực tiếp auth, perms, CRM của KPF nào.

export interface HostUser {
  uid: string;
  name: string;
  companyId: string;
  isChatAdmin: boolean;
  departmentId?: string;
  isDepartmentLead?: boolean;
}

export interface HostAdapter {
  currentUser(req: Request): Promise<HostUser | null>;
  // quyền từng dòng, vd "hoi-thoai:e", "lead:c", "thu-vien:v"
  can(user: HostUser, action: string): boolean;
  // uid trong phòng của trưởng/phó phòng
  teamUids(user: HostUser): string[];
  // tùy chọn: nối CRM và nhiệm vụ. Không có thì tính năng ẩn.
  crm?: {
    createLead(user: HostUser, input: { name: string; phone?: string; note?: string }): Promise<{ id: string }>;
  };
  tasks?: {
    createTask(user: HostUser, input: { title: string; dueAt?: number }): Promise<{ id: string }>;
  };
}

let current: HostAdapter | null = null;
export const setHost = (h: HostAdapter) => void (current = h);
export const host = (): HostAdapter => {
  if (!current) throw new Error("Chưa đăng ký host adapter");
  return current;
};
