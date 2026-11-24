// Nhóm kênh: mỗi người tự gộp vài kênh thành một nhóm để chọn một lần (ví dụ "Facebook XuXi" gồm các Page XuXi). Chỉ để xem hộp thư gọn hơn,
// không đổi quyền hay dữ liệu của kênh. Thuần hàm, dùng được cả ở giao diện.
export interface ChannelGroup { id: string; name: string; channelIds: string[] }
export const GROUP_LIMITS = { groups: 10, name: 30, channels: 50 };

// Làm sạch nhóm do người dùng gửi lên: tên không trống và không trùng, kênh phải có thật (kênh lạ bị bỏ), nhóm cần ít nhất hai kênh.
export function cleanChannelGroups(input: unknown, known: string[]): { ok: true; groups: ChannelGroup[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: "Danh sách nhóm không hợp lệ" };
  if (input.length > GROUP_LIMITS.groups) return { ok: false, error: `Tối đa ${GROUP_LIMITS.groups} nhóm kênh` };
  const out: ChannelGroup[] = [];
  for (const g of input as Array<{ id?: unknown; name?: unknown; channelIds?: unknown }>) {
    const name = String(g?.name ?? "").replace(/\s+/g, " ").trim();
    if (!name || name.length > GROUP_LIMITS.name) return { ok: false, error: `Tên nhóm từ 1 đến ${GROUP_LIMITS.name} ký tự` };
    if (out.some((x) => x.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: `Trùng tên nhóm: ${name}` };
    const ids = [...new Set((Array.isArray(g?.channelIds) ? g.channelIds : []).map(String))].filter((id) => known.includes(id)).slice(0, GROUP_LIMITS.channels);
    if (ids.length < 2) return { ok: false, error: `Nhóm "${name}" cần ít nhất hai kênh` };
    const id = typeof g?.id === "string" && /^[a-z0-9-]{3,40}$/.test(g.id) && !out.some((x) => x.id === g.id) ? g.id : `g-${Math.random().toString(36).slice(2, 8)}`;
    out.push({ id, name, channelIds: ids });
  }
  return { ok: true, groups: out };
}

// Hội thoại của kênh này có nằm trong lựa chọn không (không chọn gì là tất cả kênh)
export const matchChannel = (channelId: string, selected: string[]) => selected.length === 0 || selected.includes(channelId);

export const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

// Chữ hiện trên nút chọn kênh: Tất cả kênh, tên nhóm (nếu đúng bằng một nhóm), tên kênh, hoặc "N kênh"
export function selectionText(selected: string[], groups: ChannelGroup[], names: Record<string, string>, total: number): string {
  if (selected.length === 0) return `Tất cả kênh (${total})`;
  const g = groups.find((x) => sameSet(x.channelIds, selected));
  if (g) return g.name;
  if (selected.length === 1) return names[selected[0]] ?? "1 kênh";
  return `${selected.length} kênh`;
}
