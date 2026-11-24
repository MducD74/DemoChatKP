"use client";
/* Các mảnh nhỏ của khung chat học theo Zalo: tệp và ảnh đính kèm (bấm ảnh mở xem lớn), liên kết bấm được, bảng chọn biểu tượng cảm xúc. */
import { useEffect, useState, type ReactNode } from "react";
import type { Attachment } from "@/core/types";
import { Ic } from "./ui";

// Địa chỉ hiển thị của tệp đính kèm (ảnh TikTok phải đi qua máy chủ để lấy)
export const attSrc = (a: Attachment, channelId: string) =>
  a.url.startsWith("tiktok-media://") ? `/api/inbox/media?channel=${encodeURIComponent(channelId)}&ref=${encodeURIComponent(a.url)}` : a.url;
export const attName = (a: Attachment) => a.name || decodeURIComponent(a.url.split("?")[0].split("/").pop() || "Tệp đính kèm").slice(0, 80);
export const isMedia = (a: Attachment) => a.type === "image" || a.type === "sticker" || a.type === "video";

// Xem ảnh lớn: bấm ra ngoài hoặc Esc để đóng
export function Lightbox({ src, name, onClose }: { src: string; name?: string; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="kc-lbx" role="dialog" aria-modal="true" aria-label="Xem ảnh" onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={name ?? "ảnh"} onClick={(e) => e.stopPropagation()} />
      <div className="kc-lbx-b" onClick={(e) => e.stopPropagation()}>
        <a href={src} target="_blank" rel="noopener noreferrer">Mở ảnh gốc</a>
        <button type="button" onClick={onClose}>Đóng</button>
      </div>
    </div>
  );
}

// Chữ có liên kết: chỉ http và https, mở tab mới, không để trang kia đọc được trang này
const URL_RE = /(https?:\/\/[^\s<>"]+)/g;
export function Linkify({ text }: { text: string }): ReactNode {
  return text.split(URL_RE).map((part, i) => {
    if (i % 2 === 0) return part;
    const m = /^(.*?)([.,;:!?)\]]*)$/.exec(part);
    const url = m?.[1] ?? part, tail = m?.[2] ?? "";
    return <span key={i}><a href={url} target="_blank" rel="noopener noreferrer">{url}</a>{tail}</span>;
  });
}
// Các liên kết trong một đoạn chữ (để gom vào mục Link của cột bên phải)
export const linksIn = (text: string) => (text.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:!?)\]]+$/, ""));

const EMOJI = "😀 😁 😂 🤣 😊 😍 🥰 😘 😎 🤗 🤔 😅 😢 😭 😡 😮 👍 👏 🙏 💪 🎉 🎁 ❤️ 💕 🌹 🍎 🍊 🍓 🍇 🍉 🍌 🍍 🥭 🍑 🥝 🍒 🍋 🥤 🧃 🛒 📦 🚚 ✅ ⭐ 🔥 💯 📞 📍 ⏰".split(" ");
export function EmojiPop({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="kc-emo" role="listbox" aria-label="Biểu tượng cảm xúc">
      {EMOJI.map((e) => <button key={e} type="button" role="option" aria-selected="false" onClick={() => onPick(e)}>{e}</button>)}
    </div>
  );
}

// Một tệp đính kèm trong bong bóng tin: ảnh (bấm xem lớn), âm thanh, video, hoặc thẻ tệp có biểu tượng và tên
export function AttachmentView({ a, channelId }: { a: Attachment; channelId: string }) {
  const [big, setBig] = useState(false);
  const src = attSrc(a, channelId);
  if (a.type === "image" || a.type === "sticker")
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={a.name ?? "ảnh"} loading="lazy" className={a.type === "sticker" ? "stk" : "pic"} onClick={() => setBig(true)} />
        {big && <Lightbox src={src} name={a.name} onClose={() => setBig(false)} />}
      </>
    );
  if (a.type === "audio") return <audio controls src={src} />;
  if (a.type === "video") return <video controls src={src} style={{ maxWidth: 240, borderRadius: 8 }} />;
  return (
    <a className="kc-file" href={src} target="_blank" rel="noopener noreferrer" download>
      <span className="kc-file-i"><Ic n="file" /></span>
      <span className="kc-file-t"><b>{attName(a)}</b><em>Bấm để mở hoặc tải về</em></span>
    </a>
  );
}

// Thu nhỏ ảnh trước khi tải lên (như KP Chat 1): ảnh lớn hơn 900KB hoặc dạng webp được vẽ lại thành jpg tối đa 1600px; lỗi thì giữ nguyên tệp gốc
export function shrinkImage(f: File): Promise<File> {
  return new Promise((ok) => {
    if (f.size <= 900_000 && f.type !== "image/webp") { ok(f); return; }
    const u = URL.createObjectURL(f), im = new Image();
    im.onload = () => {
      URL.revokeObjectURL(u);
      try {
        const k = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
        const x = c.getContext("2d");
        if (!x) { ok(f); return; }
        x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
        c.toBlob((b) => ok(b && (b.size < f.size || f.type === "image/webp") ? new File([b], f.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : f), "image/jpeg", 0.85);
      } catch { ok(f); }
    };
    im.onerror = () => { URL.revokeObjectURL(u); ok(f); };
    im.src = u;
  });
}
