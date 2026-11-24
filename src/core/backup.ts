// Sao lưu và khôi phục (yêu cầu 6.1): dữ liệu (data/chat.json) và ảnh (data/media).
//
// Cách lưu, trong thư mục sao lưu (KPCHAT_BACKUP_DIR, mặc định data/backups):
//   snapshots/<YYYY-MM-DD_HHmm>/chat.json.gz   bản nén của kho dữ liệu tại thời điểm sao lưu
//   snapshots/<...>/manifest.json               thời điểm, mã băm sha256, số kênh/hội thoại/tin, danh sách ảnh của bản này
//   media/<tên ảnh>                             kho ảnh chung: ảnh không bao giờ bị sửa (tên ngẫu nhiên), nên chỉ chép ảnh mới
// Mỗi lần sao lưu đều TỰ KIỂM: giải nén, đọc lại, so mã băm và số tin; hỏng thì báo lỗi (không tính là đã sao lưu).
// Giữ KPCHAT_BACKUP_KEEP bản gần nhất (mặc định 14); ảnh không còn bản nào dùng thì xoá khỏi kho ảnh chung.
//
// QUAN TRỌNG: thư mục sao lưu nằm cùng ổ đĩa với dữ liệu thì chỉ chống được lỗi phần mềm và xoá nhầm, không chống được mất ổ.
// Khi chạy thật phải chép thư mục này ra nơi khác (xem docs/VAN-HANH.md).
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { DB } from "./store";

export interface BackupPaths { dataFile: string; mediaDir: string; backupDir: string }
export interface Manifest { id: string; at: number; sha256: string; bytes: number; counts: { channels: number; conversations: number; messages: number; contacts: number }; media: string[] }

export const defaultPaths = (env: Record<string, string | undefined> = process.env, cwd = process.cwd()): BackupPaths => ({
  dataFile: env.KPCHAT_DATA_FILE || path.join(/*turbopackIgnore: true*/ cwd, "data", "chat.json"),
  mediaDir: env.KPCHAT_MEDIA_DIR || path.join(/*turbopackIgnore: true*/ cwd, "data", "media"),
  backupDir: env.KPCHAT_BACKUP_DIR || path.join(/*turbopackIgnore: true*/ cwd, "data", "backups"),
});
export const keepCount = (env: Record<string, string | undefined> = process.env) => Math.max(1, Math.min(365, Number(env.KPCHAT_BACKUP_KEEP) || 14));

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const MEDIA_RE = /^[0-9a-f]{32}\.(jpg|png|webp)$/;
// Giờ Việt Nam (UTC+7) cho tên bản sao lưu
const stamp = (t: number) => new Date(t + 7 * 3600_000).toISOString().slice(0, 16).replace("T", "_").replace(":", "");
const counts = (db: DB) => ({ channels: Object.keys(db.channels ?? {}).length, conversations: Object.keys(db.conversations ?? {}).length, messages: Object.keys(db.messages ?? {}).length, contacts: Object.keys(db.contacts ?? {}).length });
const exists = (p: string) => fs.access(/*turbopackIgnore: true*/ p).then(() => true, () => false);
const listMedia = async (dir: string) => (await fs.readdir(/*turbopackIgnore: true*/ dir).catch(() => [] as string[])).filter((f) => MEDIA_RE.test(f)).sort();

async function writeAtomic(file: string, data: Buffer | string) {
  const tmp = file + ".tmp";
  const fh = await fs.open(/*turbopackIgnore: true*/ tmp, "w");
  try { await fh.writeFile(data); await fh.sync(); } finally { await fh.close(); }
  await fs.rename(/*turbopackIgnore: true*/ tmp, file);
}

// Tạo một bản sao lưu. text: nội dung kho lấy ngay trong máy chủ (đã ghi xong mọi thay đổi); không có thì đọc tệp dữ liệu.
export async function createBackup(p: BackupPaths, opts: { text?: string; now?: number; keep?: number } = {}): Promise<Manifest> {
  const now = opts.now ?? Date.now();
  const text = opts.text ?? (await fs.readFile(/*turbopackIgnore: true*/ p.dataFile, "utf8"));
  const db = JSON.parse(text) as DB; // tệp hỏng thì dừng ngay, không tạo bản sao lưu hỏng
  let id = stamp(now);
  const snaps = path.join(p.backupDir, "snapshots");
  for (let i = 2; await exists(path.join(snaps, id)); i++) id = `${stamp(now)}-${i}`;
  const dir = path.join(snaps, id);
  const pool = path.join(p.backupDir, "media");
  await fs.mkdir(/*turbopackIgnore: true*/ dir, { recursive: true });
  await fs.mkdir(/*turbopackIgnore: true*/ pool, { recursive: true });

  // Ảnh: chép ảnh chưa có trong kho ảnh chung
  const media = await listMedia(p.mediaDir);
  for (const f of media) {
    const dst = path.join(pool, f);
    if (!(await exists(dst))) await fs.copyFile(/*turbopackIgnore: true*/ path.join(p.mediaDir, f), dst);
  }

  const gz = gzipSync(Buffer.from(text, "utf8"), { level: 6 });
  const m: Manifest = { id, at: now, sha256: sha(text), bytes: Buffer.byteLength(text), counts: counts(db), media };
  await writeAtomic(path.join(dir, "chat.json.gz"), gz);
  await writeAtomic(path.join(dir, "manifest.json"), JSON.stringify(m, null, 1));

  // Tự kiểm: đọc lại từ đĩa như lúc khôi phục
  const check = await verifyBackup(p, id);
  if (!check.ok) throw new Error(`Bản sao lưu ${id} không đọc lại được: ${check.error}`);
  await prune(p, opts.keep ?? keepCount());
  return m;
}

export async function listBackups(p: BackupPaths): Promise<Manifest[]> {
  const snaps = path.join(p.backupDir, "snapshots");
  const out: Manifest[] = [];
  for (const d of await fs.readdir(/*turbopackIgnore: true*/ snaps).catch(() => [] as string[])) {
    try { out.push(JSON.parse(await fs.readFile(/*turbopackIgnore: true*/ path.join(snaps, d, "manifest.json"), "utf8")) as Manifest); } catch { /* thư mục dở dang: bỏ qua */ }
  }
  return out.sort((a, b) => b.at - a.at);
}

// Kiểm một bản sao lưu: giải nén được, đúng mã băm, đọc được JSON, đúng số tin, đủ ảnh.
export async function verifyBackup(p: BackupPaths, id: string): Promise<{ ok: true; manifest: Manifest; text: string } | { ok: false; error: string }> {
  try {
    const dir = path.join(p.backupDir, "snapshots", id);
    const m = JSON.parse(await fs.readFile(/*turbopackIgnore: true*/ path.join(dir, "manifest.json"), "utf8")) as Manifest;
    const text = gunzipSync(await fs.readFile(/*turbopackIgnore: true*/ path.join(dir, "chat.json.gz"))).toString("utf8");
    if (sha(text) !== m.sha256) return { ok: false, error: "sai mã băm" };
    const c = counts(JSON.parse(text) as DB);
    if (c.messages !== m.counts.messages || c.conversations !== m.counts.conversations) return { ok: false, error: "sai số tin hoặc hội thoại" };
    for (const f of m.media) if (!(await exists(path.join(p.backupDir, "media", f)))) return { ok: false, error: `thiếu ảnh ${f}` };
    return { ok: true, manifest: m, text };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Khôi phục một bản sao lưu vào tệp dữ liệu và thư mục ảnh. PHẢI TẮT máy chủ trước (máy chủ giữ dữ liệu trong bộ nhớ và sẽ ghi đè).
// Bản hiện tại được giữ lại thành chat.json.before-restore-<thời điểm> để lùi lại nếu chọn nhầm.
export async function restoreBackup(p: BackupPaths, id: string, opts: { now?: number } = {}): Promise<{ manifest: Manifest; kept?: string; mediaCopied: number }> {
  const v = await verifyBackup(p, id);
  if (!v.ok) throw new Error(`Không khôi phục được bản ${id}: ${v.error}`);
  await fs.mkdir(/*turbopackIgnore: true*/ path.dirname(p.dataFile), { recursive: true });
  let kept: string | undefined;
  if (await exists(p.dataFile)) {
    kept = `${p.dataFile}.before-restore-${stamp(opts.now ?? Date.now())}`;
    await fs.copyFile(/*turbopackIgnore: true*/ p.dataFile, kept);
  }
  await writeAtomic(p.dataFile, v.text);
  await fs.mkdir(/*turbopackIgnore: true*/ p.mediaDir, { recursive: true });
  let mediaCopied = 0;
  for (const f of v.manifest.media) {
    const dst = path.join(p.mediaDir, f);
    if (!(await exists(dst))) { await fs.copyFile(/*turbopackIgnore: true*/ path.join(p.backupDir, "media", f), dst); mediaCopied++; }
  }
  return { manifest: v.manifest, kept, mediaCopied };
}

// Giữ `keep` bản mới nhất; xoá ảnh trong kho chung không còn bản nào dùng.
async function prune(p: BackupPaths, keep: number) {
  const all = await listBackups(p);
  for (const m of all.slice(keep)) await fs.rm(/*turbopackIgnore: true*/ path.join(p.backupDir, "snapshots", m.id), { recursive: true, force: true });
  const used = new Set(all.slice(0, keep).flatMap((m) => m.media));
  for (const f of await listMedia(path.join(p.backupDir, "media"))) if (!used.has(f)) await fs.rm(/*turbopackIgnore: true*/ path.join(p.backupDir, "media", f), { force: true });
}

// ---------- Lịch sao lưu hằng ngày trong máy chủ ----------
const g = globalThis as unknown as { __kpBackupTimer?: ReturnType<typeof setInterval>; __kpBackupLast?: { at: number; ok: boolean; id?: string; error?: string } };
export const lastBackup = () => g.__kpBackupLast;

// Mỗi 10 phút xem hôm nay (giờ Việt Nam) đã có bản sao lưu sau giờ hẹn (mặc định 3 giờ sáng) chưa; chưa có thì tạo.
export function startBackupSchedule(getText: () => Promise<string>, p = defaultPaths(), hourVN = Number(process.env.KPCHAT_BACKUP_HOUR ?? 3)) {
  if (g.__kpBackupTimer) return;
  const tick = async () => {
    const now = Date.now();
    const vn = new Date(now + 7 * 3600_000);
    if (vn.getUTCHours() < hourVN) return;
    const dueAt = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate(), hourVN) - 7 * 3600_000;
    const last = (await listBackups(p).catch(() => []))[0];
    if (last && last.at >= dueAt) return;
    try {
      const m = await createBackup(p, { text: await getText(), now });
      g.__kpBackupLast = { at: now, ok: true, id: m.id };
      console.info(`[sao-luu] đã tạo ${m.id}: ${m.counts.conversations} hội thoại, ${m.counts.messages} tin, ${m.media.length} ảnh`);
    } catch (e) {
      g.__kpBackupLast = { at: now, ok: false, error: e instanceof Error ? e.message : String(e) };
      console.error(`[sao-luu] LỖI: ${g.__kpBackupLast.error}`);
    }
  };
  g.__kpBackupTimer = setInterval(() => void tick(), 10 * 60_000);
  g.__kpBackupTimer.unref?.();
  setTimeout(() => void tick(), 30_000).unref?.();
}
