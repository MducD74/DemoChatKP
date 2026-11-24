"use client";
/* Trang KP Chat: tên trang ở thanh trên, các mục chia bằng TopTabs (đúng quy ước giao diện KP Travel và KPF). */
import { useEffect, useState } from "react";
import { TopTabs } from "./ui";
import { useActor } from "./actor";
import ChatPane from "./ChatPane";
import OverviewPane from "./OverviewPane";
import SettingsPane from "./SettingsPane";
import LibraryPane from "./LibraryPane";
import StatsPane from "./StatsPane";
import AuditPane from "./AuditPane";
import BotPanel from "./BotPanel";
import { useUnreadTitle } from "./notify";
import AdminAlerts from "./AdminAlerts";

type Tab = "chat" | "stat" | "bot" | "set" | "tpl" | "log";

export default function KpChat() {
  const { me } = useActor();
  const admin = me.role === "admin";
  const [tab, setTab] = useState<Tab>("chat");
  const [open, setOpen] = useState<string | null>(null); // mở sẵn một hội thoại (từ Thống kê)
  const [unread, setUnread] = useState(0);
  const [need, setNeed] = useState(0); // hội thoại cần người (bot đã chuyển, chưa ai xử lý)
  useUnreadTitle(unread); // số chưa đọc trên tiêu đề tab trình duyệt

  // nhớ mục đang xem theo địa chỉ (?tab=) để tải lại trang không mất chỗ
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const c = sp.get("c"); // mở thẳng một hội thoại: /?c=<mã hội thoại> (từ thông báo, từ hệ thống KP khác)
    if (c) setOpen(c);
    const t = sp.get("tab");
    if (t === "ov") setTab("stat"); // địa chỉ cũ của Tổng quan, nay gộp vào Thống kê
    else if (t === "stat" || t === "bot" || t === "set" || t === "log" || t === "tpl" || t === "chat") setTab(t);
  }, []);
  const go = (t: Tab) => {
    setTab(t);
    history.replaceState(null, "", t === "chat" ? "/" : `/?tab=${t}`);
  };
  const shown: Tab = !admin && (tab === "bot" || tab === "set" || tab === "log") ? "chat" : tab;

  // Màn Hội thoại vừa khít màn hình: đo chỗ khung bắt đầu để cả trang không cuộn (cuộn thừa vài điểm làm khung bị lắc khi lăn chuột hay rê chuột).
  // Chỉ màn hình rộng; màn hình hẹp (điện thoại) giữ cách cũ.
  useEffect(() => {
    if (shown !== "chat") return;
    const fit = () => {
      const el = document.querySelector<HTMLElement>(".kc-wrap");
      const wide = window.innerWidth > 760;
      document.documentElement.style.overflow = wide ? "hidden" : "";
      if (!el) return;
      if (!wide) return void el.style.removeProperty("height");
      const top = Math.round(el.getBoundingClientRect().top + window.scrollY);
      el.style.height = `${Math.max(520, window.innerHeight - top - 14)}px`;
    };
    fit();
    const t = setTimeout(fit, 300);
    window.addEventListener("resize", fit);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", fit);
      document.documentElement.style.overflow = "";
      document.querySelector<HTMLElement>(".kc-wrap")?.style.removeProperty("height");
    };
  }, [shown]);

  const options: [Tab, string][] = [["chat", `Hội thoại${unread ? ` (${unread})` : ""}${need ? ` · ${need} cần người` : ""}`]];
  options.push(["tpl", "Thư viện mẫu"]);
  if (admin) options.push(["bot", "KP AIbot"]);
  options.push(["stat", "Thống kê"]);
  if (admin) options.push(["set", "Cài đặt"], ["log", "Nhật ký"]);

  return (
    <>
      <TopTabs value={shown} options={options} onChange={go} />
      {admin && <AdminAlerts goChannels={() => go("set")} />}
      {shown === "chat" && <ChatPane onUnread={setUnread} onNeed={setNeed} openId={open} onOpened={() => setOpen(null)} goChannels={() => go("set")} goLibrary={() => go("tpl")} />}
      {shown === "bot" && <BotPanel />}
      {shown === "set" && <SettingsPane />}
      {shown === "stat" && (
        <>
          {admin && <OverviewPane onOpen={(id) => { setOpen(id); go("chat"); }} goChannels={() => go("set")} />}
          {admin && <h3 style={{ margin: "20px 0 8px", fontSize: 15 }}>Số liệu theo thời gian</h3>}
          <StatsPane />
        </>
      )}
      {shown === "tpl" && <LibraryPane />}
      {shown === "log" && <AuditPane />}
    </>
  );
}
