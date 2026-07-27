import type { Metadata } from 'next';
import { Inspector } from 'react-dev-inspector';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: '云悦资本图像生成 JoyCloud Image',
    template: '%s · JoyCloud Image',
  },
  description:
    '生产力向批量生图控制台：按条派发独立生成任务，单张可超时自动重试、手动重试与单点中断，支持一条提示词生成三份。',
  keywords: ['批量生图', '图片生成', '工作流', 'AI 绘图', '生产力工具'],
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isDev = process.env.COZE_PROJECT_ENV === 'DEV';

  return (
    <html lang="zh-CN">
      <body className="antialiased">
        {isDev && <Inspector />}
        {children}
      </body>
    </html>
  );
}
