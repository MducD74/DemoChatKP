// Chia khách tự động theo từng kênh. Không có mặc định: kênh chưa đặt thì nhân viên tự bấm Nhận khách.
import { messagesOf, type DB } from "./store";
import type { Channel, Conversation, RoutingCfg, RoutingMode } from "./types";
import { cleanHours, workingMs } from "./sla";

export const ROUTING_MODES: RoutingMode[] = ["manual", "round_robin", "least_busy", "fixed"];
export const ONLINE_MS = 150_000; // mở KP Chat trong 2,5 phút gần nhất thì coi là đang trực tuyến

export const isOnline = (db: DB, uid: string, now: number) => !db.away?.[uid] && now - (db.seen?.[uid] ?? 0) < ONLINE_MS;

// Kiểm cấu hình do quản trị nhập. agentsWithSend: nhân viên có mức Nhắn tin ở kênh đó, theo thứ tự cố định.
export function cleanRouting(input: unknown, agentsWithSend: string[]): { ok: true; routing: RoutingCfg } | { ok: false; error: string } {
  const r = input as Partial<RoutingCfg> | null;
  if (!r || !ROUTING_MODES.includes(r.mode as RoutingMode)) return { ok: false, error: "Chế độ chia khách không hợp lệ" };
  const out: RoutingCfg = { mode: r.mode as RoutingMode };
  if (out.mode === "manual") return { ok: true, routing: out };
  if (agentsWithSend.length === 0) return { ok: false, error: "Chưa có nhân viên nào có mức Nhắn tin ở kênh này. Thêm ở mục Phân quyền trước." };
  if (out.mode === "fixed") {
    if (!r.fixedUid || !agentsWithSend.includes(r.fixedUid)) return { ok: false, error: "Chọn một nhân viên có mức Nhắn tin ở kênh này" };
    out.fixedUid = r.fixedUid;
  } else {
    if (r.pool?.length) {
      const bad = r.pool.find((u) => !agentsWithSend.includes(u));
      if (bad) return { ok: false, error: `"${bad}" chưa có mức Nhắn tin ở kênh này` };
      out.pool = agentsWithSend.filter((u) => r.pool!.includes(u));
    }
    if (r.weights) {
      out.weights = {};
      for (const [u, w] of Object.entries(r.weights)) {
        if (!agentsWithSend.includes(u)) return { ok: false, error: `"${u}" chưa có mức Nhắn tin ở kênh này` };
        const n = Math.round(Number(w));
        if (!(n >= 1 && n <= 10)) return { ok: false, error: "Tỷ lệ chia mỗi người từ 1 đến 10" };
        out.weights[u] = n;
      }
    }
    if (r.preferOnline) out.preferOnline = true;
    if (r.sticky) out.sticky = true;
  }
  const num = (v: unknown, lo: number, hi: number, msg: string): number | { error: string } => {
    const n = Math.round(Number(v));
    return n >= lo && n <= hi ? n : { error: msg };
  };
  if (r.maxOpen != null) {
    const m = num(r.maxOpen, 1, 500, "Giới hạn hội thoại đang mở phải từ 1 đến 500");
    if (typeof m !== "number") return { ok: false, error: m.error };
    out.maxOpen = m;
  }
  if (r.escalateMin != null && out.mode !== "fixed") {
    const m = num(r.escalateMin, 1, 1440, "Số phút chuyển tiếp phải từ 1 đến 1.440");
    if (typeof m !== "number") return { ok: false, error: m.error };
    out.escalateMin = m;
  }
  if (r.hours) {
    const h = cleanHours(r.hours);
    if (!h.ok) return h;
    out.hours = h.hours;
  }
  if (typeof r.cursor === "number") out.cursor = r.cursor;
  return { ok: true, routing: out };
}

const openCount = (db: DB, channelId: string, uid: string) =>
  Object.values(db.conversations).filter((c) => c.channelId === channelId && c.assigneeUid === uid && c.status !== "resolved").length;

const inHours = (cfg: RoutingCfg, now: number) => !cfg.hours || workingMs(now, now + 1, cfg.hours) > 0;

// Những người đủ điều kiện nhận khách lúc này, theo thứ tự cố định của danh sách.
export function eligible(db: DB, ch: Channel, agents: string[], now: number): string[] {
  const cfg = ch.routing;
  if (!cfg || cfg.mode === "manual" || !inHours(cfg, now)) return [];
  const base = agents.filter((u) => ch.access?.[u] === "send" && !db.away?.[u]);
  if (cfg.mode === "fixed") return cfg.fixedUid && base.includes(cfg.fixedUid) ? [cfg.fixedUid] : [];
  let pool = cfg.pool?.length ? base.filter((u) => cfg.pool!.includes(u)) : base;
  if (cfg.maxOpen) pool = pool.filter((u) => openCount(db, ch.id, u) < cfg.maxOpen!);
  if (cfg.preferOnline) {
    const on = pool.filter((u) => isOnline(db, u, now));
    if (on.length) pool = on; // không ai trực tuyến: chia đều cho những người còn lại
  }
  return pool;
}

// Chọn người nhận cho một hội thoại chưa có người phụ trách. Trả về uid hoặc null (để chưa nhận). Cập nhật vị trí xoay vòng.
export function pickAssignee(db: DB, ch: Channel, conv: Pick<Conversation, "lastAssigneeUid">, agents: string[], now: number, exclude?: string): string | null {
  const cfg = ch.routing;
  if (!cfg) return null;
  const list = eligible(db, ch, agents, now).filter((u) => u !== exclude);
  if (!list.length) return null;
  if (cfg.mode === "fixed") return list[0];
  // khách quay lại: giao lại cho người cũ nếu người đó đủ điều kiện
  if (cfg.sticky && conv.lastAssigneeUid && list.includes(conv.lastAssigneeUid)) return conv.lastAssigneeUid;
  const w = (u: string) => cfg.weights?.[u] ?? 1;
  const cursor = cfg.cursor ?? 0;
  let chosen: string;
  if (cfg.mode === "least_busy") {
    // ít việc nhất theo tỷ lệ (số hội thoại đang mở ÷ tỷ lệ chia); bằng nhau thì theo vòng
    const start = cursor % list.length;
    const rotated = [...list.slice(start), ...list.slice(0, start)];
    chosen = rotated.reduce((best, u) => (openCount(db, ch.id, u) / w(u) < openCount(db, ch.id, best) / w(best) ? u : best), rotated[0]);
  } else {
    // xoay vòng có tỷ lệ: dãy xen kẽ, người có tỷ lệ 2 xuất hiện 2 lần mỗi vòng
    const seq: string[] = [];
    for (let r = 0; r < 10; r++) for (const u of list) if (r < w(u)) seq.push(u);
    chosen = seq[cursor % seq.length];
  }
  cfg.cursor = cursor + 1;
  return chosen;
}

// Áp chia khách cho một hội thoại (sửa trực tiếp db). Chỉ chia khi chưa có người phụ trách và hội thoại chưa xong.
export function applyRouting(db: DB, conv: Conversation, agents: string[], now: number): boolean {
  const ch = db.channels[conv.channelId];
  if (!ch?.routing || conv.assigneeUid || conv.status === "resolved") return false;
  const uid = pickAssignee(db, ch, conv, agents, now);
  if (!uid) return false;
  conv.assigneeUid = uid;
  conv.assignedAt = now;
  conv.autoAssigned = true;
  return true;
}

// Chuyển tiếp: khách do hệ thống tự chia mà chờ quá escalateMin phút chưa được trả lời thì giao người khác (một lần cho mỗi tin của khách).
// Hội thoại do người bấm Nhận hoặc admin giao tay thì không bị chuyển.
export function escalateStale(db: DB, agents: string[], now: number): number {
  let n = 0;
  for (const c of Object.values(db.conversations)) {
    const ch = db.channels[c.channelId];
    const cfg = ch?.routing;
    if (!cfg?.escalateMin || !c.autoAssigned || !c.assigneeUid || c.status === "resolved" || !c.lastInboundAt) continue;
    if (c.escalatedFor === c.lastInboundAt) continue;
    // chỉ khi tin cuối là của khách (chưa ai trả lời)
    const out = messagesOf(db, c.id).some((m) => !m.internal && m.direction === "out" && m.at >= c.lastInboundAt!);
    if (out) continue;
    const waitMin = (cfg.hours ? workingMs(c.lastInboundAt, now, cfg.hours) : now - c.lastInboundAt) / 60_000;
    if (waitMin < cfg.escalateMin) continue;
    const next = pickAssignee(db, ch, c, agents, now, c.assigneeUid);
    c.escalatedFor = c.lastInboundAt; // dù có người nhận hay không cũng không thử lại cho tin này
    if (!next) continue;
    c.lastAssigneeUid = c.assigneeUid;
    c.assigneeUid = next;
    c.assignedAt = now;
    n++;
  }
  return n;
}
