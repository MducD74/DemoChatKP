# KP Chat 2.0: một tiến trình Node, dữ liệu trên ổ đĩa bền gắn vào /app/data (Railway Volume).
# Chỉ chạy MỘT bản (replica = 1): kho dữ liệu nằm trong bộ nhớ của tiến trình (src/core/store.ts).
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: không chạy script cài đặt của thư viện (an toàn chuỗi cung ứng)
RUN npm ci --ignore-scripts

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm test && npx next build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 TZ=Asia/Ho_Chi_Minh
RUN addgroup -S kp && adduser -S kp -G kp && mkdir -p /app/data && chown kp:kp /app/data
COPY --from=build --chown=kp:kp /app/.next/standalone ./
COPY --from=build --chown=kp:kp /app/.next/static ./.next/static
USER kp
VOLUME ["/app/data"]
EXPOSE 3000
# Next.js tự chờ yêu cầu đang dở và các việc after() khi nhận SIGTERM
CMD ["node", "server.js"]
