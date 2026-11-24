// Danh mục nhãn (như "Quản lý nhãn" của KP Chat 1): nhóm, màu, hay dùng (hiện sẵn ở thanh nhãn), ẩn, thứ tự. Thuần hàm, dùng được cả ở giao diện.
// Nhóm "một lựa chọn" (ví dụ Kết quả: Chốt hoặc Không chốt) thì gắn nhãn mới sẽ gỡ nhãn cũ cùng nhóm.
export interface LabelGroup { name: string; single?: boolean }
export interface LabelDef { name: string; color: string; group?: string; pinned?: boolean; hidden?: boolean; order?: number }
export interface LabelCfg { groups: LabelGroup[]; labels: Record<string, LabelDef> }

// Nhãn gọn: chỉ giữ những nhãn CRM và POS không tự biết (kết quả, nguồn, khách cũ đã có ở Giai đoạn CRM, kênh và đơn hàng). Không chia nhóm trên giao diện;
// cấu trúc vẫn có một nhóm duy nhất để tương thích dữ liệu cũ.
export const DEFAULT_LABEL_CFG: LabelCfg = {
  groups: [{ name: "Nhãn" }],
  labels: Object.fromEntries([
    { name: "Hộp quà", color: "#2563EB", group: "Nhãn", order: 10 },
    { name: "Giỏ quà", color: "#0891B2", group: "Nhãn", order: 20 },
    { name: "Trái cây cắt sẵn", color: "#7C3AED", group: "Nhãn", order: 30 },
    { name: "Nước ép", color: "#EA580C", group: "Nhãn", order: 40 },
    { name: "Khiếu nại", color: "#DC2626", group: "Nhãn", order: 50 },
    { name: "VIP", color: "#CA8A04", group: "Nhãn", order: 60 },
  ].map((l) => [l.name, l as LabelDef])),
};
export const LABEL_LIMITS = { groups: 12, labels: 200, groupName: 30, labelName: 40 };
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const FALLBACK = "#9CA3AF";

// Làm sạch cấu hình do quản trị gửi lên. Nhóm thiếu hoặc không có thì nhãn rơi vào nhóm cuối.
export function cleanLabelCfg(input: unknown): { ok: true; cfg: LabelCfg } | { ok: false; error: string } {
  const b = (input ?? {}) as { groups?: unknown; labels?: unknown };
  if (!Array.isArray(b.groups) || b.groups.length < 1) return { ok: false, error: "Cần ít nhất một nhóm nhãn" };
  if (b.groups.length > LABEL_LIMITS.groups) return { ok: false, error: `Tối đa ${LABEL_LIMITS.groups} nhóm` };
  const groups: LabelGroup[] = [];
  for (const g of b.groups as Array<{ name?: unknown; single?: unknown }>) {
    const name = String(g?.name ?? "").trim();
    if (!name || name.length > LABEL_LIMITS.groupName) return { ok: false, error: `Tên nhóm từ 1 đến ${LABEL_LIMITS.groupName} ký tự` };
    if (groups.some((x) => x.name === name)) return { ok: false, error: `Trùng nhóm: ${name}` };
    groups.push(g?.single ? { name, single: true } : { name });
  }
  const raw = b.labels && typeof b.labels === "object" ? Object.values(b.labels as Record<string, Partial<LabelDef>>) : [];
  if (raw.length > LABEL_LIMITS.labels) return { ok: false, error: `Tối đa ${LABEL_LIMITS.labels} nhãn` };
  const labels: Record<string, LabelDef> = {};
  for (const l of raw) {
    const name = String(l?.name ?? "").trim();
    if (!name) continue;
    if (name.length > LABEL_LIMITS.labelName) return { ok: false, error: `Tên nhãn tối đa ${LABEL_LIMITS.labelName} ký tự: ${name.slice(0, 20)}...` };
    const color = COLOR_RE.test(String(l?.color ?? "")) ? String(l.color) : FALLBACK;
    const group = groups.some((g) => g.name === l?.group) ? (l.group as string) : groups[groups.length - 1].name;
    const def: LabelDef = { name, color, group };
    if (l?.pinned) def.pinned = true;
    if (l?.hidden) def.hidden = true;
    if (typeof l?.order === "number" && Number.isFinite(l.order)) def.order = Math.round(l.order);
    labels[name] = def;
  }
  return { ok: true, cfg: { groups, labels } };
}

export interface LabelView extends LabelDef { group: string; known: boolean }

// Danh sách nhãn để hiện: nhãn trong danh mục (trừ nhãn ẩn, giữ nhãn đang gắn), cộng nhãn đang gắn mà chưa có trong danh mục (màu xám, nhóm cuối).
// Xếp theo nhóm, rồi thứ tự, rồi tên.
export function labelViews(cfg: LabelCfg, attached: string[] = [], opts: { withHidden?: boolean } = {}): LabelView[] {
  const last = cfg.groups[cfg.groups.length - 1]?.name ?? "Khác";
  const gi = (g: string) => { const i = cfg.groups.findIndex((x) => x.name === g); return i < 0 ? cfg.groups.length : i; };
  const out: LabelView[] = [];
  for (const d of Object.values(cfg.labels)) {
    if (d.hidden && !opts.withHidden && !attached.includes(d.name)) continue;
    out.push({ ...d, color: d.color || FALLBACK, group: d.group && cfg.groups.some((g) => g.name === d.group) ? d.group : last, known: true });
  }
  for (const name of attached) if (!cfg.labels[name]) out.push({ name, color: FALLBACK, group: last, known: false });
  return out.sort((a, b) => gi(a.group) - gi(b.group) || (a.order ?? 1e6) - (b.order ?? 1e6) || a.name.localeCompare(b.name, "vi"));
}

// Gắn hoặc gỡ một nhãn. Nhóm một lựa chọn: gắn nhãn mới thì gỡ các nhãn khác cùng nhóm.
export function toggleLabel(current: string[], name: string, on: boolean, cfg: LabelCfg): string[] {
  if (!on) return current.filter((l) => l !== name);
  const group = cfg.labels[name]?.group;
  const single = !!group && !!cfg.groups.find((g) => g.name === group)?.single;
  const keep = single ? current.filter((l) => cfg.labels[l]?.group !== group) : current;
  return keep.includes(name) ? keep : [...keep, name];
}

// Lọc theo nhiều nhãn: không chọn nhãn nào thì khớp hết; all = phải có đủ các nhãn đã chọn, không thì chỉ cần có một trong số đó.
export const matchLabels = (have: string[], selected: string[], all: boolean) =>
  selected.length === 0 || (all ? selected.every((l) => have.includes(l)) : selected.some((l) => have.includes(l)));
