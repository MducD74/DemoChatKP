// Người dùng thử của giai đoạn local. Khi gắn vào KPF, danh sách và vai trò lấy từ host adapter.
export type Role = "admin" | "agent";
export interface Actor { uid: string; name: string; role: Role }

export const DEMO_STAFF: Actor[] = [
  { uid: "admin", name: "Quản trị (thử)", role: "admin" },
  { uid: "lan", name: "Lan", role: "agent" },
  { uid: "hai", name: "Hải", role: "agent" },
];

export const staffName = (uid?: string) => DEMO_STAFF.find((s) => s.uid === uid)?.name ?? uid ?? "";

// Giai đoạn local: người đang dùng chọn qua cookie kp_actor (có công tắc ở góc hộp thư). Không có thì là admin.
export function actorFromCookie(cookie: string | null | undefined): Actor {
  const m = /(?:^|;\s*)kp_actor=([^;]+)/.exec(cookie ?? "");
  return DEMO_STAFF.find((s) => s.uid === (m && decodeURIComponent(m[1]))) ?? DEMO_STAFF[0];
}
