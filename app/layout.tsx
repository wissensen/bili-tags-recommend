import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '智能标签推荐',
  description: '创作中心智能标签推荐',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
