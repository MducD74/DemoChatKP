import type { ReactNode } from "react";
import "./kpf-base.css";
import "@/components/pages/chat.css";
import Shell from "@/components/Shell";

export const metadata = { title: "KP Chat 2.0" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <head>
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
