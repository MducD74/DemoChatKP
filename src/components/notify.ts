"use client";
// Báo tin mới (yêu cầu 3.3): âm báo ngắn, thông báo của trình duyệt khi đang ở tab khác, số chưa đọc trên tiêu đề tab.
// Chỉ báo tin KHÁCH vừa nhắn tới, ở hội thoại người này được xem; lần tải đầu tiên không báo (chỉ ghi mốc).
import { useCallback, useEffect, useRef, useState } from "react";

export interface AlertItem { id: string; contactName: string; lastText: string; lastDirection?: "in" | "out"; lastMessageAt: number; unread: boolean; channel: { name: string } }

const KEY = "kc.notify";
type Pref = { sound: boolean; desktop: boolean };
const readPref = (): Pref => {
  try { return { sound: true, desktop: true, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return { sound: true, desktop: true }; }
};

// Âm báo hai nốt tạo bằng Web Audio (không cần tệp âm thanh). Trình duyệt chỉ cho phát sau khi người dùng đã bấm vào trang ít nhất một lần.
let ctx: AudioContext | null = null;
function beep() {
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const t = ctx.currentTime;
    for (const [i, f] of [880, 1320].entries()) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.15, t + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.18);
      o.connect(g).connect(ctx.destination);
      o.start(t + i * 0.12);
      o.stop(t + i * 0.12 + 0.2);
    }
  } catch { /* trình duyệt không hỗ trợ: bỏ qua */ }
}

export function useNewMessageAlerts(opts: { selected: string | null; onOpen: (id: string) => void }) {
  const [pref, setPref] = useState<Pref>({ sound: true, desktop: true });
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  const seen = useRef<Map<string, number> | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    setPref(readPref());
    setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);

  const save = (p: Pref) => { setPref(p); try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* bỏ qua */ } };

  const askPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    const r = await Notification.requestPermission();
    setPerm(r);
    if (r === "granted") save({ ...readPref(), desktop: true });
  }, []);

  // Gọi sau mỗi lần tải danh sách hội thoại
  const check = useCallback((items: AlertItem[]) => {
    const first = seen.current === null;
    const prev = seen.current ?? new Map<string, number>();
    const fresh: AlertItem[] = [];
    for (const it of items) {
      const before = prev.get(it.id) ?? 0;
      if (!first && it.lastDirection === "in" && it.unread && it.lastMessageAt > before) fresh.push(it);
      prev.set(it.id, Math.max(before, it.lastMessageAt));
    }
    seen.current = prev;
    if (!fresh.length) return;
    const p = readPref();
    const { selected, onOpen } = optsRef.current;
    // Đang mở đúng hội thoại đó và đang nhìn tab: không cần báo
    const others = fresh.filter((f) => document.hidden || f.id !== selected);
    if (!others.length) return;
    if (p.sound) beep();
    if (p.desktop && document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
      for (const f of others.slice(0, 3)) {
        const n = new Notification(`${f.contactName} · ${f.channel.name}`, { body: f.lastText || "(đính kèm)", tag: `kpchat-${f.id}` });
        n.onclick = () => { window.focus(); onOpen(f.id); n.close(); };
      }
    }
  }, []);

  return { pref, perm, check, askPermission, setSound: (v: boolean) => save({ ...pref, sound: v }), setDesktop: (v: boolean) => save({ ...pref, desktop: v }) };
}

// Số chưa đọc trên tiêu đề tab trình duyệt
export function useUnreadTitle(n: number, base = "KP Chat 2.0") {
  useEffect(() => {
    document.title = n > 0 ? `(${n > 99 ? "99+" : n}) ${base}` : base;
    return () => { document.title = base; };
  }, [n, base]);
}
