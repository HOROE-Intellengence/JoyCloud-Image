import type { Metadata } from 'next';
import { Console } from '@/components/console/console';

export const metadata: Metadata = {
  // 首页标题不走 layout 的 template，直接用完整品牌名
  title: {
    absolute: '云悦资本图像生成 JoyCloud Image',
  },
  description:
    '按条派发独立生成任务：单张支持超时自动重试、手动重试与单点中断，可一条提示词生成三份。',
};

export default function Home() {
  return <Console />;
}
