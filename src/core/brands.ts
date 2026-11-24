// Thương hiệu: Labancorp -> Thương hiệu -> Kết nối kênh. Mỗi kênh thuộc đúng một thương hiệu; chatbot và tài liệu kiến thức mang nhãn
// thương hiệu, để chatbot của thương hiệu này không bao giờ đọc giá, chính sách của thương hiệu khác. Thương hiệu được gắn từ kênh,
// không để AI đoán. Tài liệu "Dùng chung" (SHARED) dùng được cho mọi thương hiệu; tài liệu chưa gắn nhãn không dùng được cho chatbot đã có thương hiệu.
import { mutate, type DB, type Store } from "./store";
import type { BotState } from "./chatbot";
import { PROFILE_FIELDS, PROFILE_LIMITS, type BrandKind } from "./brandprofile";

// kind: loại thương hiệu (quyết định bộ mục hồ sơ); profile: nội dung các mục hồ sơ (brandprofile.ts), mọi chatbot của thương hiệu dùng
export interface Brand { id: string; name: string; note?: string; website?: string; channelIds: string[]; at: number; kind?: BrandKind; profile?: Record<string, string>; profileAt?: number }
export const SHARED = "shared";
export const BRAND_LIMITS = { count: 30, name: 60, note: 300, website: 200 };
type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export const brandList = (db: DB): Brand[] => db.bot?.brands ?? [];
export const brandOfChannel = (db: DB, channelId: string): string | undefined => brandList(db).find((b) => b.channelIds.includes(channelId))?.id;
export const brandName = (db: DB, id?: string) => (id === SHARED ? "Dùng chung" : brandList(db).find((b) => b.id === id)?.name);
// Tài liệu có được dùng cho chatbot của thương hiệu này không. Chatbot chưa gắn thương hiệu (dữ liệu cũ) thì như trước, không lọc.
export const docAllowed = (docBrand: string | undefined, botBrand: string | undefined) => !botBrand || docBrand === SHARED || docBrand === botBrand;

const state = (db: DB): BotState => (db.bot ??= { settings: { docs: [] }, bots: {}, drafts: {} });

export interface BrandInput { id?: unknown; name?: unknown; note?: unknown; website?: unknown; channelIds?: unknown; kind?: unknown; profile?: unknown }
export async function saveBrand(store: Store, input: BrandInput, now = Date.now()): Promise<Res<{ brand: Brand }>> {
  return mutate(store, (db): Res<{ brand: Brand }> => {
    const st = state(db);
    const list = (st.brands ??= []);
    const old = typeof input.id === "string" && input.id ? list.find((b) => b.id === input.id) : undefined;
    if (input.id && !old) return { ok: false, error: "Không thấy thương hiệu" };
    const name = String(input.name ?? "").trim();
    if (!name || name.length > BRAND_LIMITS.name) return { ok: false, error: `Tên thương hiệu từ 1 đến ${BRAND_LIMITS.name} ký tự` };
    if (list.some((b) => b.id !== old?.id && b.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: "Đã có thương hiệu trùng tên" };
    if (!old && list.length >= BRAND_LIMITS.count) return { ok: false, error: `Tối đa ${BRAND_LIMITS.count} thương hiệu` };
    const note = String(input.note ?? "").trim().slice(0, BRAND_LIMITS.note);
    const website = String(input.website ?? "").trim().slice(0, BRAND_LIMITS.website);
    const channelIds = [...new Set(Array.isArray(input.channelIds) ? input.channelIds.map(String) : [])];
    for (const c of channelIds) {
      if (!db.channels[c]) return { ok: false, error: "Có kênh không còn tồn tại" };
      const other = list.find((b) => b.id !== old?.id && b.channelIds.includes(c));
      if (other) return { ok: false, error: `Kênh "${db.channels[c].name}" đã thuộc thương hiệu "${other.name}". Mỗi kênh chỉ thuộc một thương hiệu` };
    }
    if (old) {
      // kênh bị gỡ khỏi thương hiệu mà chatbot của thương hiệu vẫn dùng thì không cho gỡ
      for (const b of Object.values(st.bots ?? {})) {
        if (b.brandId !== old.id) continue;
        const lost = b.channelIds.find((c) => !channelIds.includes(c));
        if (lost) return { ok: false, error: `Chatbot "${b.name}" đang dùng kênh "${db.channels[lost]?.name ?? lost}". Gỡ kênh khỏi chatbot trước` };
      }
    }
    const kind: BrandKind = input.kind === "travel" ? "travel" : input.kind === "retail" ? "retail" : old?.kind ?? "retail";
    let profile = old?.profile;
    let profileAt = old?.profileAt;
    if (input.profile !== undefined) {
      if (!input.profile || typeof input.profile !== "object" || Array.isArray(input.profile)) return { ok: false, error: "Hồ sơ không hợp lệ" };
      const known = new Set([...PROFILE_FIELDS.retail, ...PROFILE_FIELDS.travel].map((f) => f.key));
      const next: Record<string, string> = {};
      let total = 0;
      for (const [k, v] of Object.entries(input.profile as Record<string, unknown>)) {
        if (!known.has(k)) continue;
        const t = String(v ?? "").trim();
        if (!t) continue;
        if (t.length > PROFILE_LIMITS.field) return { ok: false, error: `Mỗi mục hồ sơ tối đa ${PROFILE_LIMITS.field} ký tự` };
        total += t.length;
        next[k] = t;
      }
      if (total > PROFILE_LIMITS.total) return { ok: false, error: `Tổng hồ sơ tối đa ${PROFILE_LIMITS.total} ký tự` };
      if (JSON.stringify(next) !== JSON.stringify(old?.profile ?? {})) profileAt = now;
      profile = Object.keys(next).length ? next : undefined;
    }
    const brand: Brand = { id: old?.id ?? `br-${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`, name, ...(note ? { note } : {}), ...(website ? { website } : {}), channelIds, at: old?.at ?? now, kind, ...(profile ? { profile } : {}), ...(profileAt ? { profileAt } : {}) };
    if (old) list[list.indexOf(old)] = brand; else list.push(brand);
    return { ok: true, brand };
  });
}

export async function deleteBrand(store: Store, id: string): Promise<Res> {
  return mutate(store, (db): Res => {
    const list = db.bot?.brands;
    const b = list?.find((x) => x.id === id);
    if (!list || !b) return { ok: false, error: "Không thấy thương hiệu" };
    const bot = Object.values(db.bot?.bots ?? {}).find((x) => x.brandId === id);
    if (bot) return { ok: false, error: `Chatbot "${bot.name}" đang thuộc thương hiệu này` };
    const doc = (db.bot?.settings.docs ?? []).find((d) => d.brandId === id);
    if (doc) return { ok: false, error: `Tài liệu "${doc.title}" đang thuộc thương hiệu này` };
    list.splice(list.indexOf(b), 1);
    return { ok: true };
  });
}
