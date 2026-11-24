// Nguồn tài liệu kiến thức của chatbot: tệp tải lên, link web, link Google Drive. Lấy chữ về lưu thành tài liệu (bản chép lúc nhập).
// Chỉ quản trị dùng. Việc máy chủ tải địa chỉ do người dùng nhập là rủi ro SSRF nên: chỉ http/https, từ chối địa chỉ nội bộ
// (localhost, mạng riêng, link-local), kiểm lại ở từng bước chuyển hướng, giới hạn dung lượng và thời gian.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { mutate, type Store } from "./store";
import { DOC_CATEGORIES, LIMITS, botSettings, type DocSource, type KnowledgeDoc } from "./chatbot";
import { readPdf } from "./botmodel";
import { tidyText } from "./texttidy";

type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export const MAX_FETCH_BYTES = 5 * 1024 * 1024;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 4;

// ---------- Chặn địa chỉ nội bộ ----------
export function isPrivateIp(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  if (isIP(v) === 4) {
    const [a, b] = v.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb");
}

export async function assertPublicUrl(raw: string): Promise<{ ok: true; url: URL } | { ok: false; error: string }> {
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, error: "Địa chỉ không hợp lệ" }; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: "Chỉ nhận địa chỉ http hoặc https" };
  if (u.username || u.password) return { ok: false, error: "Địa chỉ không được chứa tên đăng nhập" };
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return { ok: false, error: "Không nhận địa chỉ nội bộ" };
  try {
    const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return { ok: false, error: "Không nhận địa chỉ nội bộ" };
  } catch { return { ok: false, error: "Không tìm thấy trang này" }; }
  return { ok: true, url: u };
}

// ---------- Link Google Drive ----------
// Chỉ đọc được tệp chia sẻ "Bất kỳ ai có đường liên kết". Tệp riêng tư cần đăng nhập Google (chưa làm).
export function driveExportUrl(raw: string): { ok: true; url: string; kind: string } | { ok: false; error: string } {
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, error: "Địa chỉ không hợp lệ" }; }
  const host = u.hostname;
  if (host !== "docs.google.com" && host !== "drive.google.com") return { ok: false, error: "Đây không phải link Google Drive hay Google Docs" };
  if (/\/folders\//.test(u.pathname) || /\/drive\/folders/.test(u.pathname)) return { ok: false, error: "Chưa đọc được cả thư mục. Dán link từng tệp" };
  const id = /\/d\/([A-Za-z0-9_-]{10,})/.exec(u.pathname)?.[1] ?? u.searchParams.get("id") ?? "";
  if (!id) return { ok: false, error: "Không tìm thấy mã tệp trong link" };
  if (host === "docs.google.com") {
    if (u.pathname.startsWith("/document/")) return { ok: true, kind: "Google Docs", url: `https://docs.google.com/document/d/${id}/export?format=txt` };
    if (u.pathname.startsWith("/spreadsheets/")) {
      const gid = u.searchParams.get("gid") ?? /gid=(\d+)/.exec(u.hash)?.[1];
      return { ok: true, kind: "Google Sheets", url: `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ""}` };
    }
    if (u.pathname.startsWith("/presentation/")) return { ok: true, kind: "Google Slides", url: `https://docs.google.com/presentation/d/${id}/export/txt` };
    return { ok: false, error: "Loại link Google này chưa hỗ trợ" };
  }
  return { ok: true, kind: "Google Drive", url: `https://drive.google.com/uc?export=download&id=${id}` };
}

// ---------- Tải về có kiểm soát ----------
export interface Fetched { bytes: Uint8Array; mime: string; finalUrl: string }
export type Fetcher = (url: string) => Promise<Res<{ fetched: Fetched }>>;
let fetcherOverride: Fetcher | undefined;
export const setFetcher = (f: Fetcher | undefined) => void (fetcherOverride = f);

export const safeFetch: Fetcher = async (raw) => {
  if (fetcherOverride) return fetcherOverride(raw);
  let cur = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const chk = await assertPublicUrl(cur);
    if (!chk.ok) return chk;
    let res: Response;
    try {
      res = await fetch(chk.url, { redirect: "manual", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { "user-agent": "KPChat-Knowledge/1.0", accept: "text/html,text/plain,text/csv,application/pdf,application/json;q=0.9,*/*;q=0.1" } });
    } catch { return { ok: false, error: "Không tải được trang (quá thời gian hoặc không nối được)" }; }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { ok: false, error: "Trang chuyển hướng không hợp lệ" };
      cur = new URL(loc, chk.url).toString();
      if (new URL(cur).hostname === "accounts.google.com") return { ok: false, error: "Tệp chưa chia sẻ công khai: ở Google bấm Chia sẻ, chọn \"Bất kỳ ai có đường liên kết\" (người xem)" };
      continue;
    }
    if (!res.ok) return { ok: false, error: res.status === 404 ? "Không thấy trang (404)" : res.status === 401 || res.status === 403 ? "Trang không cho truy cập (cần đăng nhập hoặc chưa chia sẻ công khai)" : `Trang trả lỗi ${res.status}` };
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_FETCH_BYTES) return { ok: false, error: "Tệp quá lớn (tối đa 5MB)" };
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body?.getReader();
    if (!reader) return { ok: false, error: "Trang không có nội dung" };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_FETCH_BYTES) { await reader.cancel().catch(() => undefined); return { ok: false, error: "Tệp quá lớn (tối đa 5MB)" }; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { bytes.set(c, o); o += c.byteLength; }
    return { ok: true, fetched: { bytes, mime: (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase(), finalUrl: cur } };
  }
  return { ok: false, error: "Trang chuyển hướng quá nhiều lần" };
};

// ---------- Đổi nội dung thành chữ ----------
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
// Dữ liệu cấu trúc (JSON-LD) mà nhiều trang bán hàng có sẵn: lấy tên, giá, mô tả sản phẩm cho sạch hơn chép chữ trên trang.
function jsonLdProducts(html: string): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  const walk = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return void n.forEach(walk);
    const o = n as Record<string, unknown>;
    const t = ([] as unknown[]).concat(o["@type"] ?? []).map(String);
    if (t.includes("Product") && typeof o.name === "string") {
      const offers = ([] as unknown[]).concat(o.offers ?? []).flatMap((x) => (x && typeof x === "object" ? [x as Record<string, unknown>, ...(([] as unknown[]).concat((x as Record<string, unknown>).offers ?? []) as Record<string, unknown>[])] : []));
      const prices = [...new Set(offers.flatMap((f) => [f.price, f.lowPrice, f.highPrice]).filter((v) => v !== undefined && v !== "").map((v) => Number(v)).filter((v) => Number.isFinite(v)))];
      const cur = String(offers.find((f) => f.priceCurrency)?.priceCurrency ?? "");
      const fmt = (v: number) => `${v.toLocaleString("vi-VN")}${cur === "VND" || cur === "" ? "đ" : ` ${cur}`}`;
      const price = prices.length ? prices.length > 1 ? `${fmt(Math.min(...prices))} - ${fmt(Math.max(...prices))}` : fmt(prices[0]) : "";
      const desc = typeof o.description === "string" ? htmlToText(o.description).text.replace(/\s+/g, " ").slice(0, 300) : "";
      const line = `- ${o.name.trim()}${price ? `: ${price}` : ""}${desc ? `. ${desc}` : ""}`;
      if (!seen.has(line)) { seen.add(line); lines.push(line); }
    }
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
  };
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1])); } catch { /* bỏ qua khối lỗi */ }
  }
  return lines;
}

export function htmlToText(html: string): { title?: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const products = jsonLdProducts(html);
  // Ưu tiên phần nội dung chính nếu trang có
  const main = /<main[\s>][\s\S]*<\/main>/i.exec(html)?.[0] ?? /<article[\s>][\s\S]*<\/article>/i.exec(html)?.[0] ?? html;
  const body = main
    .replace(/<(script|style|noscript|svg|head|nav|header|footer|aside|form|button|select|iframe|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|br|section|article|table|ul|ol)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " "; }
      return ENT[e.toLowerCase()] ?? m;
    });
  const text = tidyText(body);
  const withProducts = products.length ? `Sản phẩm (dữ liệu có cấu trúc của trang):\n${products.join("\n")}${text ? `\n\nNội dung trang:\n${text}` : ""}` : text;
  return { title: title?.replace(/\s+/g, " ").trim(), text: withProducts };
}

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|log)$/i;
const looksBinary = (b: Uint8Array) => b.subarray(0, 4096).includes(0);

export async function bytesToText(bytes: Uint8Array, mime: string, name: string): Promise<Res<{ text: string; title?: string }>> {
  const lower = name.toLowerCase();
  if (mime === "application/pdf" || lower.endsWith(".pdf") || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    if (bytes.byteLength > MAX_FILE_BYTES) return { ok: false, error: "PDF quá lớn (tối đa 10MB)" };
    const r = await readPdf(bytes);
    return r.ok ? { ok: true, text: r.text } : r;
  }
  if (/\.(docx?|xlsx?|pptx?)$/i.test(lower) || /officedocument|msword|ms-excel/.test(mime)) return { ok: false, error: "Chưa đọc được Word, Excel, PowerPoint. Hãy lưu thành PDF, .txt hoặc .csv, hoặc dán link Google Docs/Sheets" };
  if (looksBinary(bytes)) return { ok: false, error: "Loại tệp này chưa đọc được. Dùng .txt, .md, .csv, .json, .html hoặc PDF" };
  const raw = new TextDecoder("utf-8").decode(bytes);
  if (mime === "text/html" || /\.html?$/i.test(lower) || /^\s*<(!doctype|html)/i.test(raw)) { const h = htmlToText(raw); return { ok: true, text: h.text, title: h.title }; }
  if (mime.startsWith("text/") || mime === "application/json" || mime === "application/xml" || TEXT_EXT.test(lower) || mime === "") return { ok: true, text: raw.replace(/\r\n/g, "\n").trim() };
  return { ok: false, error: "Loại tệp này chưa đọc được. Dùng .txt, .md, .csv, .json, .html hoặc PDF" };
}

// ---------- Thêm và làm mới tài liệu ----------
const newId = () => `doc-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const hostOf = (u: string) => { try { return new URL(u).hostname; } catch { return "tài liệu"; } };

function fit(text: string): { body: string; truncated: boolean } | null {
  const body = text.trim();
  if (!body) return null;
  return body.length > LIMITS.docBody ? { body: body.slice(0, LIMITS.docBody), truncated: true } : { body, truncated: false };
}

export interface ImportInput { kind: "web" | "drive" | "file"; url?: string; title?: string; category?: string; channelIds?: string[]; brandId?: string; file?: { bytes: Uint8Array; mime: string; name: string } }

async function readSource(input: ImportInput): Promise<Res<{ text: string; title: string; source: DocSource }>> {
  const at = Date.now();
  if (input.kind === "file") {
    const f = input.file;
    if (!f || !f.bytes.byteLength) return { ok: false, error: "Thiếu tệp" };
    if (f.bytes.byteLength > MAX_FILE_BYTES) return { ok: false, error: "Tệp quá lớn (tối đa 10MB)" };
    const t = await bytesToText(f.bytes, f.mime, f.name);
    if (!t.ok) return t;
    return { ok: true, text: t.text, title: (t.title ?? f.name.replace(/\.[a-z0-9]+$/i, "")) || "Tệp", source: { type: "file", fileName: f.name.slice(0, 120), at } };
  }
  const url = String(input.url ?? "").trim();
  let target = url, kind: "web" | "drive" = "web", label = "";
  if (input.kind === "drive") {
    const d = driveExportUrl(url);
    if (!d.ok) return d;
    target = d.url; kind = "drive"; label = d.kind;
  }
  const f = await safeFetch(target);
  if (!f.ok) return f;
  const { bytes, mime, finalUrl } = f.fetched;
  // Google trả trang đăng nhập (HTML) thay cho tệp khi chưa chia sẻ công khai
  if (kind === "drive" && mime === "text/html" && /accounts\.google\.com|ServiceLogin|Sign in/i.test(new TextDecoder().decode(bytes.subarray(0, 20000)))) return { ok: false, error: "Tệp chưa chia sẻ công khai: ở Google bấm Chia sẻ, chọn \"Bất kỳ ai có đường liên kết\" (người xem)" };
  const t = await bytesToText(bytes, mime, new URL(finalUrl).pathname.split("/").pop() ?? "");
  if (!t.ok) return t;
  return { ok: true, text: t.text, title: t.title || label || hostOf(url), source: { type: kind, url, at } };
}

export async function importDoc(store: Store, input: ImportInput): Promise<Res<{ doc: KnowledgeDoc }>> {
  const r = await readSource(input);
  if (!r.ok) return r;
  const f = fit(r.text);
  if (!f) return { ok: false, error: "Không lấy được chữ nào từ nguồn này" };
  const title = (String(input.title ?? "").trim() || r.title).slice(0, LIMITS.docTitle);
  return mutate(store, (db): Res<{ doc: KnowledgeDoc }> => {
    const st = (db.bot ??= { settings: { docs: [] }, bots: {}, drafts: {} });
    const set = botSettings(db);
    if (set.docs.length >= LIMITS.docs) return { ok: false, error: `Tối đa ${LIMITS.docs} tài liệu` };
    if (set.docs.reduce((s, d) => s + d.body.length, 0) + f.body.length > LIMITS.docsTotal) return { ok: false, error: `Tổng nội dung tài liệu tối đa ${LIMITS.docsTotal} ký tự. Xóa bớt tài liệu cũ` };
    const channelIds = [...new Set((input.channelIds ?? []).map(String))].filter((c) => db.channels[c]);
    const category = input.category && DOC_CATEGORIES.includes(input.category) ? input.category : undefined;
    const brandId = input.brandId === "shared" || (input.brandId && (db.bot?.brands ?? []).some((b) => b.id === input.brandId)) ? input.brandId : undefined;
    const doc: KnowledgeDoc = { id: newId(), title, body: f.body, at: Date.now(), source: { ...r.source, ...(f.truncated ? { truncated: true } : {}) }, ...(category ? { category } : {}), ...(channelIds.length ? { channelIds } : {}), ...(brandId ? { brandId } : {}) };
    st.settings = { ...set, docs: [...set.docs, doc] };
    return { ok: true, doc };
  });
}

// Lấy lại nội dung từ link (web, drive). Giữ tên và id; ghi đè nội dung.
export async function refreshDoc(store: Store, id: string): Promise<Res<{ doc: KnowledgeDoc }>> {
  const cur = botSettings(await store.load()).docs.find((d) => d.id === id);
  if (!cur) return { ok: false, error: "Không thấy tài liệu" };
  const s = cur.source;
  if (!s || (s.type !== "web" && s.type !== "drive") || !s.url) return { ok: false, error: "Chỉ làm mới được tài liệu từ link web hoặc Drive" };
  const r = await readSource({ kind: s.type, url: s.url });
  if (!r.ok) return r;
  const f = fit(r.text);
  if (!f) return { ok: false, error: "Không lấy được chữ nào từ nguồn này" };
  return mutate(store, (db): Res<{ doc: KnowledgeDoc }> => {
    const set = botSettings(db);
    const d = set.docs.find((x) => x.id === id);
    if (!d) return { ok: false, error: "Không thấy tài liệu" };
    const others = set.docs.reduce((n, x) => n + (x.id === id ? 0 : x.body.length), 0);
    if (others + f.body.length > LIMITS.docsTotal) return { ok: false, error: `Tổng nội dung tài liệu tối đa ${LIMITS.docsTotal} ký tự` };
    d.body = f.body; d.at = Date.now(); d.source = { ...(d.source as DocSource), at: Date.now(), checkedAt: Date.now(), issue: undefined, ...(f.truncated ? { truncated: true } : { truncated: undefined }) };
    (db.bot as NonNullable<typeof db.bot>).settings = { ...set, docs: set.docs };
    return { ok: true, doc: d };
  });
}

// ---------- Tự làm mới ----------
// Tài liệu bật "Tự làm mới" (web, drive) được lấy lại khi có tin khách đến mà bản chép đã cũ hơn AUTO_REFRESH_HOURS.
// Không có bộ hẹn giờ riêng: chạy theo tin khách để chạy được cả trên máy chủ không giữ tiến trình. Có kiểm tra trước khi ghi đè:
// nội dung rỗng, lỗi tải, hoặc khác bản cũ quá nhiều thì GIỮ BẢN CŨ và ghi lý do (hiện ở Kiến thức), người quản trị bấm Làm mới nếu muốn lấy.
export const AUTO_REFRESH_HOURS = 6;
const RETRY_AFTER_ERROR_HOURS = 1;
const HOUR = 3_600_000;
const MIN_OLD_FOR_GUARD = 300; // bản cũ quá ngắn thì không so tỉ lệ

export function autoRefreshGuard(oldLen: number, newLen: number): string | null {
  if (newLen === 0) return "Nội dung lấy về rỗng, giữ bản cũ";
  if (oldLen < MIN_OLD_FOR_GUARD) return null;
  if (newLen < oldLen * 0.3 || newLen > oldLen * 3) return `Nội dung mới khác bản cũ quá nhiều (${oldLen.toLocaleString("vi-VN")} → ${newLen.toLocaleString("vi-VN")} ký tự), giữ bản cũ. Bấm Làm mới nếu đúng`;
  return null;
}

export const isAutoDue = (s: DocSource | undefined, now: number) => !!s && s.auto === true && (s.type === "web" || s.type === "drive") && !!s.url && now - (s.checkedAt ?? s.at) >= AUTO_REFRESH_HOURS * HOUR;

export async function setDocAuto(store: Store, id: string, auto: boolean): Promise<Res<{ doc: KnowledgeDoc }>> {
  return mutate(store, (db): Res<{ doc: KnowledgeDoc }> => {
    const set = botSettings(db);
    const d = set.docs.find((x) => x.id === id);
    if (!d) return { ok: false, error: "Không thấy tài liệu" };
    const s = d.source;
    if (!s || (s.type !== "web" && s.type !== "drive") || !s.url) return { ok: false, error: "Chỉ tài liệu từ link web hoặc Drive mới tự làm mới được" };
    d.source = { ...s, auto, issue: undefined, ...(auto ? { checkedAt: Date.now() } : {}) };
    (db.bot as NonNullable<typeof db.bot>).settings = { ...set, docs: set.docs };
    return { ok: true, doc: d };
  });
}

let autoRun: Promise<void> | null = null;
// Làm mới các tài liệu đến hạn, lần lượt. Không ném lỗi.
export async function autoRefreshDocs(store: Store, now = Date.now()): Promise<{ refreshed: string[]; kept: string[] }> {
  const out = { refreshed: [] as string[], kept: [] as string[] };
  const due = botSettings(await store.load()).docs.filter((d) => isAutoDue(d.source, now));
  for (const cur of due) {
    const s = cur.source as DocSource;
    const r = await readSource({ kind: s.type as "web" | "drive", url: s.url });
    const f = r.ok ? fit(r.text) : null;
    const issue = !r.ok ? `Lần tự làm mới gần nhất lỗi: ${r.error}. Đang dùng bản cũ` : !f ? "Nội dung lấy về rỗng, giữ bản cũ" : autoRefreshGuard(cur.body.length, f.body.length);
    await mutate(store, (db): Res => {
      const set = botSettings(db);
      const d = set.docs.find((x) => x.id === cur.id);
      if (!d || !d.source) return { ok: false, error: "Không thấy tài liệu" };
      if (issue || !f) {
        // lỗi mạng thử lại sau 1 giờ; nội dung bất thường thì chờ chu kỳ sau
        const retry = !r.ok ? now - (AUTO_REFRESH_HOURS - RETRY_AFTER_ERROR_HOURS) * HOUR : now;
        d.source = { ...d.source, checkedAt: retry, issue: issue ?? "Không lấy được nội dung" };
        out.kept.push(d.id);
      } else {
        const others = set.docs.reduce((n, x) => n + (x.id === d.id ? 0 : x.body.length), 0);
        if (others + f.body.length > LIMITS.docsTotal) { d.source = { ...d.source, checkedAt: now, issue: `Tổng nội dung tài liệu vượt ${LIMITS.docsTotal.toLocaleString("vi-VN")} ký tự, giữ bản cũ` }; out.kept.push(d.id); }
        else {
          const changed = d.body !== f.body;
          if (changed) { d.body = f.body; d.at = now; }
          d.source = { ...d.source, ...(changed ? { at: now } : {}), checkedAt: now, issue: undefined, ...(f.truncated ? { truncated: true } : { truncated: undefined }) };
          if (changed) out.refreshed.push(d.id);
        }
      }
      (db.bot as NonNullable<typeof db.bot>).settings = { ...set, docs: set.docs };
      return { ok: true };
    });
  }
  return out;
}

// Gọi trước khi soạn trả lời. Chờ tối đa waitMs để tin đầu tiên trong ngày đã dùng bản mới; quá hạn thì vẫn chạy nền. Chỉ một lượt chạy cùng lúc.
export async function maybeAutoRefreshDocs(store: Store, now = Date.now(), waitMs = 6000): Promise<void> {
  try {
    if (!autoRun) {
      const db = await store.load();
      if (!botSettings(db).docs.some((d) => isAutoDue(d.source, now))) return;
      autoRun = autoRefreshDocs(store, now).then(() => undefined, () => undefined).finally(() => { autoRun = null; });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([autoRun, new Promise<void>((res) => { timer = setTimeout(res, waitMs); })]);
    clearTimeout(timer);
  } catch { /* không để lỗi làm hỏng việc trả lời khách */ }
}
