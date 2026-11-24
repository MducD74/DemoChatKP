"use client";
/* Khung trang giống Shell của KPF (menu trái, thanh trên có #top-slot cho TopTabs). Khi gắn vào KPF dùng Shell của KPF. */
import { useEffect, useState, type ReactNode } from "react";
import { ActorContext, type ActorCtx } from "./actor";
import { Ic, usePersist } from "./ui";

export default function Shell({ children }: { children: ReactNode }) {
  const [ctx, setCtx] = useState<ActorCtx | null>(null);
  const [rail, setRail] = usePersist<boolean>("kc.rail", false); // menu trái thu thành thanh biểu tượng để có thêm chỗ cho hộp thư (như menu của KPF)
  useEffect(() => {
    fetch("/api/me", { cache: "no-store" }).then((r) => r.json()).then(setCtx).catch(() => undefined);
  }, []);

  // Nhân viên: báo đang trực tuyến mỗi phút (để chia khách ưu tiên người trực tuyến)
  useEffect(() => {
    if (ctx?.me.role !== "agent") return;
    const ping = () => { if (!document.hidden) fetch("/api/staff/ping", { method: "POST" }).catch(() => undefined); };
    ping();
    const t = setInterval(ping, 60_000);
    return () => clearInterval(t);
  }, [ctx?.me.role, ctx?.me.uid]);
  const setAway = async (away: boolean) => {
    if (!ctx) return;
    const r = await fetch("/api/staff/away", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ away }) }).then((x) => x.json()).catch(() => ({}));
    if (r.ok) setCtx({ ...ctx, away: { ...ctx.away, [ctx.me.uid]: away } });
  };

  // Giai đoạn local: chọn người dùng thử bằng cookie. Khi gắn vào KPF, người dùng lấy từ phiên đăng nhập của KPF.
  const switchTo = (uid: string) => {
    document.cookie = `kp_actor=${encodeURIComponent(uid)}; path=/; max-age=31536000; samesite=lax`;
    location.reload();
  };

  return (
    <div className={`app nodock${rail ? " noside" : ""}`}>
      <aside className="side">
        <div className="logo"><b>K</b><span className="nl">KP Chat</span><button type="button" className="sbt" aria-pressed={rail} title={rail ? "Mở rộng menu" : "Thu gọn menu"} aria-label={rail ? "Mở rộng menu" : "Thu gọn menu"} onClick={() => setRail(!rail)}>{rail ? "›" : "‹"}</button></div>
        <a className="nav on" href="/" title="KP Chat"><Ic n="chat" /><span className="nl">KP Chat</span></a>
        <div className="kv nl" style={{ padding: "12px 10px 0", color: "#7f8fc4" }}>Bản 2.0 · chạy thử trên máy<br />Chưa nối vào KPF</div>
      </aside>

      <section className="main">
        <div className="top">
          <h1>KP Chat</h1>
          <div id="top-slot" className="top-slot" />
          <span className="sp" />
          {ctx?.me.role === "agent" && (
            <label className="fresh" title="Tắt thì hệ thống không chia khách tự động cho bạn (khách đang giữ vẫn là của bạn)">
              <input type="checkbox" checked={!ctx.away?.[ctx.me.uid]} onChange={(e) => setAway(!e.target.checked)} /> Đang nhận khách
            </label>
          )}
          {ctx && (
            <label className="fresh" title="Chỉ có ở bản chạy thử: chọn người dùng để thử quyền Quản trị và Nhân viên">
              <span className="hide-m">Đang dùng với tư cách</span>
              <select value={ctx.me.uid} onChange={(e) => switchTo(e.target.value)}>
                {ctx.staff.map((s) => <option key={s.uid} value={s.uid}>{s.name} ({s.role === "admin" ? "Quản trị" : "Nhân viên"})</option>)}
              </select>
            </label>
          )}
        </div>
        <div className="page">
          {ctx ? <ActorContext.Provider value={ctx}>{children}</ActorContext.Provider> : <div className="kv">Đang tải...</div>}
        </div>
      </section>

      <nav className="bn" aria-label="Điều hướng">
        <a href="/" className="on"><Ic n="chat" />KP Chat</a>
      </nav>
    </div>
  );
}
