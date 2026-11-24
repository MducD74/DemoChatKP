import { NextResponse } from "next/server";
import { adminOnly, boot, store } from "@/server";
import { ADVICE_TEMPLATES, BOT_TYPES, DEFAULT_INTRO, DOC_CATEGORIES, TONES, botList, botSettings, botStats, saveBotSettings, syncBotKey } from "@/core/chatbot";
import { BOT_MODELS, DEFAULT_BOT_MODEL, providerStatus } from "@/core/botmodel";
import { SCRIPT_LIBS, ensureScripts } from "@/core/botscripts";
import { brandList } from "@/core/brands";
import { botOutcomes } from "@/core/botevals";
import { webCfg } from "@/core/webchat";
import { baseUrl } from "@/server";

export const dynamic = "force-dynamic";

// Trang Chatbot (quản trị): danh sách chatbot đã tạo, kho kiến thức, kênh để gắn. Không bao giờ trả khóa API, chỉ cho biết đã có khóa hay chưa.
async function view(req: Request) {
  await ensureScripts(store); // nạp kịch bản mẫu một lần cho lần đầu mở
  const db = await store.load();
  syncBotKey(db);
  return {
    outcomes: botOutcomes(db), // chỉ số kết quả 30 ngày theo chatbot (có số điện thoại, chuyển người)
    brands: brandList(db), // thương hiệu và kênh của từng thương hiệu
    adviceTemplates: ADVICE_TEMPLATES(), // mẫu hướng dẫn tư vấn để chép vào ô Nhiệm vụ (chốt sale, chăm sóc)
    scripts: db.bot?.scripts ?? [], // kho mẫu (không có botId) và kịch bản riêng của từng chatbot (có botId)
    scriptLibs: SCRIPT_LIBS,
    settings: botSettings(db),
    bots: botList(db).map((b) => ({ ...b, stats: botStats(db, Date.now(), b.id) })),
    types: BOT_TYPES,
    tones: TONES,
    docCategories: DOC_CATEGORIES,
    models: BOT_MODELS,
    defaults: { model: DEFAULT_BOT_MODEL, intro: DEFAULT_INTRO },
    provider: providerStatus(),
    stats: botStats(db),
    // Khung chat trên web: khóa kênh là công khai (nằm trong mã nhúng). base: địa chỉ công khai để khách tải script (localhost chỉ chạy trên máy này).
    webchats: Object.values(db.channels).filter((c) => c.kind === "web" && !c.off).map((c) => ({ id: c.id, name: c.name, key: c.externalId, ...webCfg(c), origins: webCfg(c).origins.join("\n"), position: webCfg(c).position })),
    base: baseUrl(req),
    channels: Object.values(db.channels).filter((c) => !c.off).map((c) => ({ id: c.id, name: c.name, kind: c.kind, sendEnabled: c.sendEnabled })),
  };
}

export async function GET(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  return NextResponse.json(await view(req));
}

// Cài đặt chung: kho kiến thức, tạm dừng, hạn mức ngày
export async function PUT(req: Request) {
  boot();
  const a = adminOnly(req);
  if (a instanceof NextResponse) return a;
  const body = await req.json().catch(() => ({}));
  const r = await saveBotSettings(store, body);
  return NextResponse.json(r.ok ? { ok: true, ...(await view(req)) } : r, { status: r.ok ? 200 : 400 });
}
