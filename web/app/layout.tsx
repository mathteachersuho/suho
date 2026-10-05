import type { Metadata, Viewport } from "next";
import { Jua, Noto_Sans_KR } from "next/font/google";
import "./globals.css";

// 제목: 동글동글한 Jua, 본문: 읽기 편한 Noto Sans KR
const display = Jua({ variable: "--font-display", weight: "400", subsets: ["latin"], display: "swap" });
const body = Noto_Sans_KR({ variable: "--font-body", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "수학클래스룸",
  description: "우리 학원 수학 문제, 숙제, 오답노트",
};

export const viewport: Viewport = { themeColor: "#7c5cff" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${display.variable} ${body.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
