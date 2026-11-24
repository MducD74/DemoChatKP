"use client";
/* Ô Xem thử ở trang riêng của chatbot: trò chuyện thử với cấu hình ĐANG SỬA (chưa cần lưu). Không gửi tin cho ai, không lưu hội thoại. */
import { useEffect, useRef, useState } from "react";

export interface PreviewForm { brandId?: string; name: string; type: string; mode: string; tone: string; instructions: string; docIds: string[]; useTemplates: boolean; model: string; channelIds: string[] }
interface Bubble { role: "user" | "assistant"; text: string; kind?: "reply" | "handoff" | "error"; note?: string }

const QUICK = ["Bên mình có những món gì vậy?", "Có giao tận nhà không, phí bao nhiêu?", "Đắt quá, giảm cho em được không?", "Cho em gặp nhân viên"];

async function api(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  return r.json().catch(() => ({ ok: false, error: "Không đọc được phản hồi" }));
}

export default function BotPreview({ botId, form, resetKey }: { botId?: string; form: PreviewForm; resetKey: string }) {
  const [msgs, setMsgs] = useState<Bubble[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [tokens, setTokens] = useState({ input: 0, output: 0 });
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { setMsgs([]); setText(""); setTokens({ input: 0, output: 0 }); }, [resetKey]);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [msgs, busy]);

  async function send(raw: string) {
    const t = raw.trim();
    if (!t || busy) return;
    const next: Bubble[] = [...msgs, { role: "user", text: t }];
    setMsgs(next); setText(""); setBusy(true);
    // gửi lên: tin của khách và các lời chatbot đã trả lời; bỏ qua lỗi và chỗ chuyển người
    const history = next.filter((m) => m.role === "user" || m.kind === "reply").map((m) => ({ role: m.role, content: m.text }));
    const r = await api("/api/bot/preview", { botId, form, messages: history });
    setBusy(false);
    if (!r.ok) return setMsgs([...next, { role: "assistant", kind: "error", text: r.error ?? "Không xem thử được" }]);
    if (r.usage) setTokens((k) => ({ input: k.input + r.usage.input, output: k.output + r.usage.output }));
    setMsgs([...next, r.kind === "handoff" ? { role: "assistant", kind: "handoff", text: r.reason } : { role: "assistant", kind: "reply", text: r.text, note: r.note }]);
  }

  return (
    <aside className="bp-card bp-pv" aria-label="Xem thử chatbot">
      <div className="bp-pv-h">
        <b>Xem thử</b>
        <button type="button" className="bp-pv-r" title="Làm mới cuộc thử" aria-label="Làm mới cuộc thử" onClick={() => { setMsgs([]); setTokens({ input: 0, output: 0 }); }} disabled={!msgs.length && !busy}>↻</button>
      </div>
      <div className="bp-pv-b">
        {msgs.length === 0 && (
          <div className="bp-pv-e">
            <span className="spark" aria-hidden="true">✦</span>
            <b>Tôi có thể giúp gì cho bạn?</b>
            <small>Hỏi như một khách. Dùng cấu hình đang sửa, chưa cần lưu; không gửi tin cho ai.</small>
            <div className="bp-pv-q">{QUICK.map((q) => <button key={q} type="button" onClick={() => send(q)}>{q}</button>)}</div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`bp-pv-m ${m.role === "user" ? "u" : "a"} ${m.kind ?? ""}`}>
            {m.kind === "handoff" ? <><b>Chatbot chuyển cho nhân viên</b><span>{m.text}</span></> : <span>{m.text}</span>}
            {m.note && <small>Ghi chú cho nhân viên: {m.note}</small>}
          </div>
        ))}
        {busy && <div className="bp-pv-m a wait"><span className="dots" aria-label="Đang soạn"><i /><i /><i /></span></div>}
        <div ref={end} />
      </div>
      <form className="bp-pv-f" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <textarea rows={2} value={text} maxLength={1000} placeholder="Nhập tin của khách..." aria-label="Tin của khách" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(text); } }} />
        <button type="submit" className="bp-pv-s" aria-label="Gửi" disabled={busy || !text.trim()}>↑</button>
      </form>
      <small className="bp-pv-t">KP AIbot có thể mắc sai lầm. Kiểm tra thông tin quan trọng.{(tokens.input > 0 || tokens.output > 0) && ` Đã dùng ${tokens.input.toLocaleString("vi-VN")} token vào, ${tokens.output.toLocaleString("vi-VN")} token ra.`}</small>
    </aside>
  );
}
