"use client";
/* Cài đặt > Khóa AI: quản trị nhập khóa API Anthropic cho chatbot. Khóa lưu mã hóa ở máy chủ, giao diện không bao giờ nhận lại khóa. */
import { useCallback, useEffect, useState } from "react";

async function api(url: string, method = "GET", body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  return r.json().catch(() => ({}));
}
interface St { source: "settings" | "env" | null; last4?: string }

export default function BotKeyPanel() {
  const [st, setSt] = useState<St | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; s: string } | null>(null);
  const load = useCallback(() => api("/api/bot/key").then((j) => setSt({ source: j.source ?? null, last4: j.last4 })), []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    setBusy(true); setMsg(null);
    const j = await api("/api/bot/key", "PUT", { key });
    setBusy(false);
    if (!j.ok) return setMsg({ ok: false, s: j.error ?? "Không lưu được" });
    setKey("");
    setSt({ source: j.source ?? null, last4: j.last4 });
    setMsg({ ok: true, s: j.checked ? "Đã kiểm khóa với Anthropic và lưu." : `Đã lưu. ${j.warning ?? ""}` });
  }
  async function remove() {
    if (!confirm("Xóa khóa đã lưu? Chatbot sẽ không soạn được nữa (trừ khi máy chủ còn khóa trong biến môi trường).")) return;
    const j = await api("/api/bot/key", "DELETE");
    setSt({ source: j.source ?? null, last4: j.last4 });
    setMsg({ ok: true, s: "Đã xóa khóa." });
  }

  return (
    <div className="kcp">
      <p className="kcp-lead">Chatbot gọi mô hình Claude của Anthropic bằng khóa API này. Lấy khóa ở <b>console.anthropic.com</b> (mục API keys). Khóa được <b>mã hóa khi lưu</b> và không hiện lại trên trang; mỗi lần chatbot soạn tin sẽ tính tiền vào tài khoản Anthropic của khóa.</p>
      <div className="kcp-card">
        <header>
          <div className="kcp-t">
            <b>Khóa API Anthropic</b>
            <small>{!st ? "Đang tải..." : st.source === "settings" ? `Đã nhập ở đây (kết thúc bằng ${st.last4})` : st.source === "env" ? "Đang dùng khóa trong biến môi trường ANTHROPIC_API_KEY của máy chủ" : "Chưa có khóa: chatbot chưa soạn được"}</small>
          </div>
          {st?.source === "settings" && <div className="kcp-act"><button className="d" onClick={remove}>Xóa khóa</button></div>}
        </header>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input className="kcp-in" style={{ flex: 1, minWidth: 260 }} type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-..." value={key} onChange={(e) => { setKey(e.target.value); setMsg(null); }} />
          <button className="btn cta" disabled={busy || !key.trim()} onClick={save}>{busy ? "Đang kiểm..." : st?.source === "settings" ? "Đổi khóa" : "Lưu khóa"}</button>
        </div>
        {st?.source === "settings" && <div className="kv">Khóa nhập ở đây được ưu tiên hơn khóa trong biến môi trường.</div>}
        {msg && <span className="kcp-msg" style={{ color: msg.ok ? "var(--ok)" : "var(--bad)" }}>{msg.s}</span>}
      </div>
    </div>
  );
}
