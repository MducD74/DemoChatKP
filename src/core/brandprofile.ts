// Hồ sơ thương hiệu: các mục thông tin bắt buộc (giao hàng, thanh toán, đổi trả...) do quản trị điền MỘT lần cho thương hiệu;
// mọi KP AIbot của thương hiệu đó dùng ngay, không phải sửa từng chatbot. Mô-đun thuần, không nạp kho dữ liệu (giao diện cũng dùng).
export type BrandKind = "retail" | "travel";
export interface ProfileField { key: string; label: string; hint: string; example: string }

export const BRAND_KINDS: [BrandKind, string, string][] = [
  ["retail", "Bán lẻ, quà tặng, thực phẩm", "Xuxi Fruit, Labanfood: giao hàng, thanh toán, đổi trả, chứng nhận, thiệp"],
  ["travel", "Du lịch, lữ hành", "La Bàn Travel: giấy phép, đặt cọc, hủy tour, giá theo ngày, visa"],
];

export const PROFILE_FIELDS: Record<BrandKind, ProfileField[]> = {
  retail: [
    { key: "delivery", label: "Giao hàng", hint: "Khu vực giao, phí giao, thời gian giao, đơn tối thiểu, miễn phí từ bao nhiêu", example: "Giao nội thành Đà Nẵng. Phí tính theo app Grab hoặc Xanh SM, báo khách sau khi có địa chỉ. Giảm 20k phí ship cho đơn trên 290k." },
    { key: "payment", label: "Thanh toán", hint: "Chuyển khoản, tiền mặt, trả khi nhận hàng, đặt cọc, số tài khoản", example: "Chuyển khoản trước rồi nhân viên lên đơn, hoặc trả tiền ship cho shipper khi nhận." },
    { key: "returns", label: "Đổi trả và hoàn tiền", hint: "Khi hàng hư, dập, giao sai: báo trong bao lâu, đổi hay hoàn", example: "Báo trong 2 giờ kèm ảnh. Nhân viên đổi hàng mới hoặc hoàn tiền." },
    { key: "certs", label: "Chứng nhận, nguồn gốc, dị ứng", hint: "Giấy an toàn thực phẩm, nguồn gốc, chất gây dị ứng. Chưa chắc thì ghi để chuyển nhân viên", example: "Cơ sở có giấy chứng nhận vệ sinh an toàn thực phẩm số ... Trái cây nhập từ ..." },
    { key: "hours", label: "Giờ làm việc, địa chỉ, liên hệ", hint: "Giờ mở cửa, địa chỉ cửa hàng, hotline, Zalo", example: "34A Hoài Thanh, Ngũ Hành Sơn. Mở 8h đến 21h hằng ngày. Hotline ..." },
    { key: "invoice", label: "Xuất hóa đơn", hint: "Có xuất không, cách yêu cầu, thông tin cần cung cấp", example: "Có xuất hóa đơn VAT, khách gửi tên công ty và mã số thuế trước khi thanh toán." },
    { key: "gift", label: "Thiệp, gói quà, giao nhiều địa chỉ", hint: "Có thiệp, viết thiệp tay, túi xách, giao nhiều nơi trong một đơn", example: "Có thiệp sẵn và viết tay theo nội dung khách gửi, kèm túi xách. Giao nhiều địa chỉ tính phí từng nơi." },
    { key: "bulk", label: "Đặt trước và đơn số lượng lớn", hint: "Đặt trước bao lâu, số lượng nào thì chuyển nhân viên báo giá riêng", example: "Đặt trước cuối tuần và lễ trước ít nhất 1 ngày. Từ 10 hộp trở lên chuyển nhân viên báo giá." },
  ],
  travel: [
    { key: "licence", label: "Giấy phép lữ hành, thông tin doanh nghiệp", hint: "Tên pháp lý, số giấy phép lữ hành, mã số thuế, địa chỉ văn phòng", example: "Công ty ..., giấy phép lữ hành quốc tế số ..., MST ..., địa chỉ ..." },
    { key: "payment", label: "Thanh toán và đặt cọc", hint: "Mức cọc, hạn thanh toán, hình thức, số tài khoản", example: "Cọc 50% khi giữ chỗ, thanh toán đủ trước ngày đi 7 ngày. Chuyển khoản vào tài khoản công ty." },
    { key: "cancel", label: "Hủy, đổi tour và hoàn tiền", hint: "Bậc phí hủy theo số ngày trước ngày đi, điều kiện đổi ngày", example: "Hủy trước 15 ngày: không mất phí. Hủy từ 7 đến 14 ngày: mất 30%..." },
    { key: "pricing", label: "Giá và điều kiện báo giá", hint: "Giá khởi điểm, giá đổi theo ngày và số người, bao gồm gì, không bao gồm gì. Chatbot không báo giá cuối", example: "Giá từ ... mỗi khách, tùy ngày và số người. Chưa gồm vé máy bay. Báo giá cuối do nhân viên." },
    { key: "docs", label: "Visa, giấy tờ, trẻ em", hint: "Giấy tờ cần mang, quy định trẻ em, visa nếu đi nước ngoài", example: "Khách mang CCCD hoặc hộ chiếu còn hạn. Trẻ dưới 5 tuổi ... " },
    { key: "insurance", label: "Bảo hiểm", hint: "Có bảo hiểm du lịch không, mức bảo hiểm", example: "Đã gồm bảo hiểm du lịch trong nước mức ..." },
    { key: "hours", label: "Giờ làm việc và liên hệ", hint: "Giờ tư vấn, hotline, Zalo, email", example: "Tư vấn 8h đến 21h. Hotline ..." },
    { key: "handoff", label: "Khi nào chuyển nhân viên", hint: "Tour riêng, đoàn công ty, ngày cao điểm, ca cần báo giá cuối", example: "Chuyển nhân viên khi khách hỏi tour riêng, đoàn từ 10 người, Tết, hoặc cần báo giá cuối." },
  ],
};
export const PROFILE_LIMITS = { field: 1500, total: 9000 };

export const fieldsOf = (kind?: BrandKind): ProfileField[] => PROFILE_FIELDS[kind ?? "retail"] ?? PROFILE_FIELDS.retail;
export const filledCount = (kind: BrandKind | undefined, profile?: Record<string, string>) => fieldsOf(kind).filter((f) => (profile?.[f.key] ?? "").trim()).length;

// Phần đưa vào lời nhắc của chatbot thuộc thương hiệu. Mục chưa điền được nêu rõ để chatbot không bịa.
export function profilePrompt(name: string, kind: BrandKind | undefined, profile?: Record<string, string>): string {
  const fields = fieldsOf(kind);
  const have = fields.filter((f) => (profile?.[f.key] ?? "").trim());
  const miss = fields.filter((f) => !(profile?.[f.key] ?? "").trim());
  if (!have.length && !miss.length) return "";
  const body = have.map((f) => `### ${f.label}\n${(profile?.[f.key] ?? "").trim()}`).join("\n\n");
  const gap = miss.length ? `\n\nCHƯA CÓ THÔNG TIN (không bịa; khách hỏi thì nói em kiểm tra lại với ${name} và chuyển người nếu khách cần ngay): ${miss.map((f) => f.label).join("; ")}.` : "";
  return `THÔNG TIN CHÍNH THỨC CỦA ${name.toUpperCase()} (quản trị đã xác nhận; mâu thuẫn với tài liệu khác thì theo mục này):\n${body}${gap}`;
}
