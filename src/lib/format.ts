/** 通用格式化与下载工具 */

export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

/** 分:秒（`03:18`）。批次与单张的计时/倒计时统一用这个口径 */
export function formatMinSec(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatClock(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 跨域签名 URL 下载：必须 fetch + blob，<a download> 对跨域无效 */
export async function downloadFile(url: string, filename: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`下载失败 (HTTP ${response.status})`);
  const blob = await response.blob();
  const blobUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(blobUrl);
}

/**
 * 结果文件名：`01-提示词.png`；一生三等多份场景带份号 `01-v2-提示词.png`。
 * variant 传 null 表示单份，不加份号。
 */
export function safeFileName(
  prompt: string,
  index: number,
  variant: number | null = null,
): string {
  const base = prompt
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const seq = String(index + 1).padStart(2, '0');
  const variantPart = variant === null ? '' : `-v${variant + 1}`;
  return `${seq}${variantPart}-${base || 'image'}.png`;
}
