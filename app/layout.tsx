import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '上传视频 · 智能标签推荐',
  description: '创作者后台智能标签推荐演示项目',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
