/** @type {import('next').NextConfig} */
const nextConfig = {
  // Bản chạy gọn cho Docker/Railway: .next/standalone/server.js (xem Dockerfile)
  output: "standalone",
  // zca-js (Zalo cá nhân) chạy ở máy chủ, không đóng gói vào bản build
  serverExternalPackages: ["zca-js"],
  // Cho phép mở bản chạy thử qua đường hầm công khai khi nối Meta, Zalo, TikTok trên máy
  allowedDevOrigins: ["*.trycloudflare.com", "*.ngrok-free.app", "*.ngrok-free.dev", "*.ngrok.app", "*.loca.lt"],
};
export default nextConfig;
