"use client";
/* Mục Cài đặt (chỉ quản trị): các nhóm thu gọn như KP Chat 1.1, nhớ nhóm đang mở. */
import { useEffect, useState, type ReactNode } from "react";
import { usePersist } from "./ui";
import ChannelsPane from "./ChannelsPane";
import AccessPanel from "./AccessPanel";
import SlaPanel from "./SlaPanel";
import RoutingPanel from "./RoutingPanel";
import BotKeyPanel from "./BotKeyPanel";
import LabelsPanel from "./LabelsPanel";

// slot: nhóm tự đặt các ô lọc và nút ngay trên hàng tiêu đề (qua cổng React vào #kc-slot-<id>)
interface Item { id: string; title: string; sum: string; body: ReactNode; slot?: boolean }

export default function SettingsPane() {
  const [open, setOpen] = usePersist<string>("kc.setopen", "conn");
  // Quay về sau khi cấp quyền hoặc đăng nhập Facebook: đọc kết quả trên địa chỉ MỘT lần (trước khi bị xóa), mở nhóm Kết nối kênh
  const [back] = useState(() => {
    const sp = typeof location === "undefined" ? new URLSearchParams() : new URLSearchParams(location.search);
    return { meta: sp.get("meta") ?? undefined, connected: sp.get("connected") ?? undefined, error: sp.get("error") ?? undefined };
  });
  useEffect(() => {
    if (back.meta || back.connected || back.error) {
      setOpen("conn");
      history.replaceState(null, "", "/?tab=set");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const groups: { head: string; items: Item[] }[] = [
    { head: "Kênh", items: [
      { id: "conn", title: "Kết nối kênh", sum: "", slot: true, body: <ChannelsPane back={back} /> },
    ] },
    { head: "Nhãn", items: [
      { id: "labels", title: "Danh mục nhãn", sum: "Nhóm, màu, nhãn hay dùng, nhãn ẩn, nhóm chỉ gắn một nhãn (Chốt hoặc Không chốt)", body: <LabelsPanel /> },
    ] },
    { head: "Chia khách", items: [
      { id: "routing", title: "Chế độ chia khách theo kênh", sum: "Tự nhận, xoay vòng, theo tải, cố định; tỷ lệ chia, trực tuyến, giới hạn, chuyển tiếp", body: <RoutingPanel /> },
    ] },
    { head: "Chất lượng phục vụ", items: [
      { id: "sla", title: "SLA theo kênh và theo sale", sum: "Thời gian trả lời tối đa, giờ làm việc, ngưỡng riêng từng sale. Không có mặc định: tự cài", body: <SlaPanel /> },
    ] },
    { head: "KP AIbot", items: [
      { id: "botkey", title: "Khóa AI (Anthropic)", sum: "Khóa API để chatbot gọi mô hình Claude. Lưu mã hóa, không hiện lại", body: <BotKeyPanel /> },
    ] },
    { head: "Phân quyền", items: [
      { id: "access", title: "Kênh và người thao tác", sum: "Nhân viên nào được vào từng kênh, mức Nhắn tin hoặc Chỉ xem", body: <AccessPanel /> },
    ] },
  ];
  return (
    <div className="crm-acc" style={{ width: "100%", maxWidth: "none", margin: 0 }}>
      {groups.map((g) => (
        <section key={g.head}>
          <h4>{g.head}</h4>
          {g.items.map((it) => (
            <div key={it.id} className={`crm-acc-i ${open === it.id ? "open" : ""}`}>
              <div className="crm-acc-h kc-acc-h">
                <button type="button" className="kc-acc-t" aria-expanded={open === it.id} onClick={() => setOpen(open === it.id ? "" : it.id)}>
                  <span className="t">{it.title}{it.sum && <small>{it.sum}</small>}</span>
                </button>
                {it.slot && open === it.id ? <div className="kc-acc-slot" id={`kc-slot-${it.id}`} /> : <span className="sp" />}
                <button type="button" className="kc-acc-c" aria-label={open === it.id ? "Thu gọn" : "Mở rộng"} onClick={() => setOpen(open === it.id ? "" : it.id)}><i aria-hidden="true">▾</i></button>
              </div>
              {open === it.id && <div className="crm-acc-b">{it.body}</div>}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
