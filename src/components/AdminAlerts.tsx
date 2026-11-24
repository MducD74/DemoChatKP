"use client";
// Băng cảnh báo vận hành cho quản trị, hiện ở mọi mục: token kênh hết hạn hoặc bị thu hồi, Page chưa đăng ký nhận tin, webhook ngắt.
// Hỏi máy chủ mỗi 5 phút (máy chủ lưu đệm, không gọi Meta mỗi lần). Ẩn tạm được trong phiên; cảnh báo mới thì hiện lại.
import { useCallback, useEffect, useState } from "react";
import type { OpsAlert } from "@/core/alerts";

export default function AdminAlerts({ goChannels }: { goChannels: () => void }) {
  const [alerts, setAlerts] = useState<OpsAlert[]>([]);
  const [hidden, setHidden] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (fresh = false) => {
    try {
      const r = await fetch(`/api/alerts${fresh ? "?fresh=1" : ""}`, { cache: "no-store" });
      if (r.ok) setAlerts(((await r.json()).alerts ?? []) as OpsAlert[]);
    } catch { /* mất mạng: giữ cảnh báo cũ */ }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5 * 60_000);
    return () => clearInterval(t);
  }, [load]);
  const sig = alerts.map((a) => a.key).join("|");
  if (!alerts.length || hidden === sig) return null;
  const bad = alerts.some((a) => a.level === "error");
  return (
    <div role="alert" className={`kc-ops ${bad ? "bad" : "warn"}`}>
      <div className="kc-ops-b">
        <b>{bad ? "Cần xử lý ngay" : "Cần chú ý"}</b>
        <ul>{alerts.map((a) => <li key={a.key}>{a.text}</li>)}</ul>
      </div>
      <div className="kc-ops-t">
        <button type="button" className="btn cta" onClick={goChannels}>Mở Cài đặt &gt; Kênh</button>
        <button type="button" className="btn" disabled={busy} onClick={async () => { setBusy(true); await load(true); setBusy(false); }}>{busy ? "Đang kiểm..." : "Kiểm tra lại"}</button>
        <button type="button" className="btn" title="Ẩn đến khi có cảnh báo khác" onClick={() => setHidden(sig)}>Ẩn</button>
      </div>
    </div>
  );
}
