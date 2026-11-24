import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Thành phần giao diện chạy trong trình duyệt: không được nạp (kể cả gián tiếp) mã dùng node:fs, kho dữ liệu hay máy chủ,
// nếu không Turbopack báo lỗi "does not support external modules" và cả trang trắng.
const root = path.join(process.cwd(), "src");
const BAD = /from\s+["'](node:[^"']+|@\/server|@\/core\/store|\.\/store|\.\.\/core\/store)["']|import\(["']node:/;
const valueImports = (src: string) => [...src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? path.join(root, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;
  for (const c of [base + ".ts", base + ".tsx", path.join(base, "index.ts")]) if (existsSync(c)) return c;
  return null;
}
function reaches(file: string, seen = new Set<string>()): string | null {
  if (seen.has(file)) return null;
  seen.add(file);
  const src = readFileSync(file, "utf8");
  if (BAD.test(src.replace(/^import\s+type[^;]*;/gm, ""))) return file;
  for (const spec of valueImports(src)) {
    const r = resolve(file, spec);
    if (r) { const hit = reaches(r, seen); if (hit) return `${path.relative(root, file)} → ${hit}`; }
  }
  return null;
}

test("thành phần giao diện không nạp mã máy chủ (node:fs, kho dữ liệu) dù gián tiếp", () => {
  const dir = path.join(root, "components");
  const files = readdirSync(dir).filter((f) => f.endsWith(".tsx") && readFileSync(path.join(dir, f), "utf8").startsWith('"use client"'));
  assert.ok(files.length > 10);
  for (const f of files) assert.equal(reaches(path.join(dir, f)), null, `${f} nạp mã máy chủ`);
});
