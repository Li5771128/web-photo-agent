import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "RefTone",
  description: "从参考图生成可解释的 Lightroom 调色计划",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
