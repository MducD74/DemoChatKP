// Dọn chữ chép từ trang web: bỏ dòng giao diện (menu, giỏ hàng, nút), dòng trống thừa, dòng lặp liền nhau.
// Hàm thuần, không phụ thuộc Node: máy chủ dùng khi nhập từ web, giao diện dùng cho nút "Dọn dòng thừa" ở cửa sổ Sửa tài liệu.
const NOISE: RegExp[] = [
  /^bỏ qua nội dung$/i, /^skip to content$/i, /^menu$/i, /^trang chủ$/i, /^tìm kiếm[.…]{0,3}$/i, /^search[.…]{0,3}$/i,
  /^giỏ hàng$/i, /^cart$/i, /^chưa có sản phẩm trong giỏ hàng[.…]?$/i, /^không có sản phẩm nào[.…]{0,3}$/i, /^quay (trở )?lại (cửa hàng|trang chủ)$/i,
  /^đăng (nhập|ký)( \/ đăng (nhập|ký))?$/i, /^log ?in$/i, /^sign ?(in|up)$/i, /^tài khoản$/i,
  /^xem chi tiết$/i, /^xem thêm( \d+ sản phẩm)?$/i, /^read more$/i, /^thêm vào giỏ( hàng)?$/i, /^add to cart$/i, /^mua ngay$/i, /^chọn (tùy chọn|mua)$/i,
  /^giảm giá!?$/i, /^hết hàng$/i, /^sale!?$/i, /^mới!?$/i, /^yêu thích$/i, /^so sánh$/i, /^xem nhanh$/i,
  /^sắp xếp theo.*$/i, /^hiển thị (\d+|tất cả).*$/i, /^\d+ sản phẩm$/i, /^lọc.*$/i, /^chia sẻ.*$/i, /^(facebook|zalo|twitter|pinterest|instagram|youtube|tiktok)$/i,
  /^(copyright|©|bản quyền).*$/i, /^\(\d+\)$/, /^\d+$/,
  /^(cookie|chấp nhận|đồng ý)( tất cả)?( cookie)?$/i,
];

export function tidyText(raw: string): string {
  const out: string[] = [];
  let prev = "";
  for (const line0 of raw.replace(/\r\n?/g, "\n").split("\n")) {
    const line = line0.replace(/[ \t ]+/g, " ").trim();
    if (line && NOISE.some((re) => re.test(line))) continue;
    if (line && line === prev) continue; // dòng lặp liền nhau
    if (!line && (out.length === 0 || out[out.length - 1] === "")) continue; // không để dòng trống đầu hoặc liên tiếp
    out.push(line);
    if (line) prev = line;
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}
