"use client";
/* Một nút "Chatbot" nhỏ ở đầu khung chat thay cho hàng trạng thái và hàng "Gợi ý tin nhắn": cho biết bot đang làm gì với hội thoại này và gom các thao tác về bot vào một menu
   (Tiếp quản hoặc Giao lại, Nhờ chatbot gợi ý). Gán chatbot cho hội thoại ở cột hồ sơ bên phải. */
import { useEffect, useRef, useState } from "react";
import { BOT_STATE_LABEL, statusToState } from "@/core/botfilter";

export type BotKind = "none" | "bot" | "draft" | "paused" | "handoff";
export interface BotStatusLite { kind: BotKind; text: string; canTake?: boolean; canBack?: boolean }
export interface BotAssignLite { options: { id: string; name: string; mode: string }[]; sel: string; withStaff: boolean; picked: { id: string; name: string; mode: string } | null; auto?: { id: string; name: string } | null }

// Chữ trên nút: "Chatbot" kèm đúng tên trạng thái của bộ lọc (BOT_STATE_LABEL), nên ba chỗ hiển thị luôn khớp
export const botPill = (kind: BotKind) => (kind === "none" ? "Chatbot" : `Chatbot · ${BOT_STATE_LABEL[statusToState(kind)]}`);

export default function BotMenu({ status, canAsk, busy, onTake, onBack, onAsk, defaultOpen = false }: {
  status?: BotStatusLite; canAsk: boolean; busy: boolean;
  onTake: () => void; onBack: () => void; onAsk: () => void; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  const kind = status?.kind ?? "none";
  // Không có chatbot nào cho hội thoại này và cũng không có gì để làm thì không hiện nút
  if (kind === "none" && !canAsk) return null;
  const done = (f: () => void) => () => { setOpen(false); f(); };
  return (
    <div className="kc-bm" ref={box}>
      <button type="button" className={`kc-bm-b ${kind}`} aria-haspopup="menu" aria-expanded={open} title={status?.text || "Chatbot"} onClick={() => setOpen(!open)}><i aria-hidden="true" />{botPill(kind)}<span aria-hidden="true">▾</span></button>
      {open && (
        <div className="kc-bm-m" role="menu" aria-label="KP AIbot">
          {status?.canTake && <button type="button" role="menuitem" disabled={busy} onClick={done(onTake)}>{kind === "handoff" ? "Nhận khách" : "Tiếp quản"}</button>}
          {status?.canBack && <button type="button" role="menuitem" disabled={busy} onClick={done(onBack)}>Giao lại cho chatbot</button>}
          {canAsk && <button type="button" role="menuitem" disabled={busy} onClick={done(onAsk)}>{busy ? "Đang soạn..." : "Nhờ chatbot gợi ý"}</button>}
        </div>
      )}
    </div>
  );
}
