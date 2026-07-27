import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { Inspector } from 'react-dev-inspector';
import './globals.css';

/**
 * 正文衬线体自托管（见 DESIGN.md）。
 *
 * 为什么不用 Google Fonts：
 * 1. `globals.css` 顶部的远程 `@import` 会被 Next 的 CSS 管道整条剥离，字体根本不会加载
 *    （实测构建产物里没有任何 googleapis/gstatic 引用，页面静默回落到 Georgia/宋体）
 * 2. 本应用面向国内网络部署，客户端直连 fonts.googleapis.com 不可靠
 * 3. `next/font/google` 虽能构建期下载并自托管，但要求**构建机**能出网到 gstatic
 *
 * 因此把 woff2 收进仓库，构建与运行都不依赖外网。可变字体，覆盖 wght 200–900、opsz 8–60。
 * 仅含 latin 子集——Source Serif 4 没有中文字形，中文一律按 globals.css 的 `--font-serif` 栈回落。
 */
const sourceSerif = localFont({
  src: [
    {
      path: './fonts/source-serif-4-latin.woff2',
      weight: '200 900',
      style: 'normal',
    },
    {
      path: './fonts/source-serif-4-latin-italic.woff2',
      weight: '200 900',
      style: 'italic',
    },
  ],
  variable: '--font-source-serif',
  display: 'swap',
  fallback: ['Georgia', 'serif'],
});

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
    // 字体变量必须挂在 html 上：globals.css 的 --font-serif 在 :root 里引用它
    <html lang="zh-CN" className={sourceSerif.variable}>
      <body className="antialiased">
        {isDev && <Inspector />}
        {children}
      </body>
    </html>
  );
}
