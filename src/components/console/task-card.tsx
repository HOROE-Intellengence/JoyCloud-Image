'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  Loader2,
  Maximize2,
  RotateCcw,
  Square,
  TimerOff,
} from 'lucide-react';
import { TASK_TIMEOUT_MS, type ImageTask, type PreviewImage } from '@/lib/tasks';
import { downloadFile } from '@/lib/format';
import { cn } from '@/lib/utils';

interface TaskCardProps {
  task: ImageTask;
  /** 展示编号：#01 或 #01-2 */
  label: string;
  fileName: string;
  staggerIndex: number;
  /** 由上层统一驱动的时钟，用于倒计时（避免每张卡各起一个定时器） */
  now: number;
  onExpand: (image: PreviewImage) => void;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
}

const TIMEOUT_SECONDS = Math.round(TASK_TIMEOUT_MS / 1000);

export function TaskCard({
  task,
  label,
  fileName,
  staggerIndex,
  now,
  onExpand,
  onRetry,
  onCancel,
}: TaskCardProps) {
  const [loaded, setLoaded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleDownload = async () => {
    if (!task.url || downloading) return;
    setDownloading(true);
    try {
      await downloadFile(task.url, fileName);
    } catch {
      // 下载失败静默（网络问题），保持 UI 稳定
    } finally {
      setDownloading(false);
    }
  };

  const handleCopy = async () => {
    if (!task.url) return;
    try {
      await navigator.clipboard.writeText(task.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // 剪贴板不可用时忽略
    }
  };

  const entranceStyle = { animationDelay: `${Math.min(staggerIndex, 24) * 40}ms` };

  // ── 排队中 ──────────────────────────────────────────────
  if (task.status === 'queued') {
    return (
      <Shell label={label} tone="idle">
        <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
          {task.prompt}
        </p>
        <div className="mt-auto flex flex-col gap-2">
          <span className="font-mono text-[11px] text-faint">
            {task.attempt > 0 ? `等待重试 · 第 ${task.attempt + 1} 次` : '排队中'}
          </span>
          <CardButton tone="neutral" onClick={() => onCancel(task.id)}>
            <Square className="size-3" />
            移出队列
          </CardButton>
        </div>
      </Shell>
    );
  }

  // ── 生成中（含单张超时倒计时 + 单点中断）────────────────────
  if (task.status === 'running') {
    const elapsed = task.startedAt ? Math.max(0, now - task.startedAt) : 0;
    // 超时口径是「无进展时长」：每来一个上游进展事件就重新计时
    const sinceProgress = task.lastProgressAt
      ? Math.max(0, now - task.lastProgressAt)
      : elapsed;
    const remaining = Math.max(0, TASK_TIMEOUT_MS - sinceProgress);
    const remainingSec = Math.ceil(remaining / 1000);
    const progress = Math.min(100, (sinceProgress / TASK_TIMEOUT_MS) * 100);
    const nearTimeout = remaining < TASK_TIMEOUT_MS * 0.15;

    return (
      <Shell label={label} tone="running">
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {task.prompt}
        </p>
        <div className="mt-auto flex flex-col gap-2">
          <div className="flex items-baseline justify-between font-mono text-[11px]">
            <span className="text-signal">
              已耗时 {(elapsed / 1000).toFixed(0)}s
            </span>
            <span
              className={nearTimeout ? 'text-destructive' : 'text-faint'}
              title="距上一个上游进展事件的剩余判定时间；每收到新事件即重新计时"
            >
              无进展 {remainingSec}s
            </span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-sm bg-muted">
            <div
              className={cn(
                'h-full transition-[width] duration-500 ease-linear',
                nearTimeout ? 'bg-destructive' : 'bg-signal',
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-faint">
              第 {task.attempt}/{task.maxAttempts} 次
            </span>
            <button
              type="button"
              onClick={() => onCancel(task.id)}
              className="flex h-6 items-center gap-1 rounded-sm border border-destructive/40 px-2 text-[11px] text-destructive transition-colors hover:bg-destructive/10"
            >
              <Square className="size-2.5 fill-current" />
              中断此张
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  // ── 失败 / 已中断 ────────────────────────────────────────
  if (task.status === 'failed' || task.status === 'cancelled') {
    const isCancelled = task.status === 'cancelled';
    const isTimeout = task.failureKind === 'timeout';
    return (
      <Shell label={label} tone={isCancelled ? 'idle' : 'failed'}>
        <div className="flex items-center gap-1 font-mono text-[10px]">
          {isTimeout ? (
            <TimerOff className="size-3 text-destructive" />
          ) : (
            <AlertTriangle
              className={cn(
                'size-3',
                isCancelled ? 'text-faint' : 'text-destructive',
              )}
            />
          )}
          <span className={isCancelled ? 'text-faint' : 'text-destructive'}>
            {isCancelled ? 'CANCELLED' : isTimeout ? 'TIMEOUT' : 'FAILED'}
          </span>
        </div>
        <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
          {task.prompt}
        </p>
        <p
          className={cn(
            'mt-1 line-clamp-2 text-[10px] leading-relaxed',
            isCancelled ? 'text-faint' : 'text-destructive/80',
          )}
        >
          {task.error || '生成失败'}
        </p>
        <div className="mt-auto pt-2">
          <CardButton tone="danger" onClick={() => onRetry(task.id)}>
            <RotateCcw className="size-3" />
            {isCancelled ? '继续生成' : '重试此张'}
          </CardButton>
        </div>
      </Shell>
    );
  }

  // ── 成功 ────────────────────────────────────────────────
  return (
    <div
      style={entranceStyle}
      className="group relative aspect-square animate-card-in overflow-hidden rounded-md border border-border bg-muted"
    >
      {!loaded && <div className="absolute inset-0 shimmer-bg" />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={task.url}
        alt={task.prompt}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        className={cn(
          'absolute inset-0 size-full object-cover transition-opacity duration-300',
          loaded ? 'opacity-100' : 'opacity-0',
        )}
      />

      <span className="absolute left-2 top-2 rounded-sm bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white/90 backdrop-blur-sm">
        {label}
      </span>

      <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/85 via-black/30 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <div className="flex flex-col gap-2 p-2.5">
          <p className="line-clamp-2 text-[11px] leading-relaxed text-white/90">
            {task.prompt}
          </p>
          <div className="flex items-center gap-1">
            <CardAction
              label="下载"
              onClick={handleDownload}
              disabled={downloading}
            >
              {downloading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
            </CardAction>
            <CardAction label="复制链接" onClick={handleCopy}>
              {copied ? (
                <Check className="size-3.5 text-success" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </CardAction>
            <CardAction
              label="放大"
              onClick={() =>
                onExpand({
                  url: task.url,
                  prompt: task.prompt,
                  label,
                  fileName,
                })
              }
            >
              <Maximize2 className="size-3.5" />
            </CardAction>
            <CardAction label="重新生成" onClick={() => onRetry(task.id)}>
              <RotateCcw className="size-3.5" />
            </CardAction>
            {task.elapsedMs > 0 && (
              <span className="ml-auto font-mono text-[10px] text-white/70">
                {(task.elapsedMs / 1000).toFixed(0)}s
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 非成功态的卡片外壳：统一编号角标与边框语义 */
function Shell({
  label,
  tone,
  children,
}: {
  label: string;
  tone: 'idle' | 'running' | 'failed';
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex aspect-square flex-col rounded-md border p-3',
        tone === 'running' && 'border-signal/50 bg-signal/[0.04]',
        tone === 'failed' && 'border-destructive/40 bg-destructive/[0.04]',
        tone === 'idle' && 'border-dashed border-border bg-background',
      )}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-faint">{label}</span>
        {tone === 'running' && (
          <span className="size-1.5 rounded-full bg-signal animate-signal-pulse" />
        )}
      </div>
      <div className="mt-2 flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

function CardButton({
  children,
  onClick,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone: 'neutral' | 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-7 w-full items-center justify-center gap-1.5 rounded-sm border text-[11px] transition-colors',
        tone === 'danger'
          ? 'border-destructive/40 text-destructive hover:bg-destructive/10'
          : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function CardAction({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-7 items-center justify-center rounded-sm bg-white/10 text-white/90 backdrop-blur-sm transition-colors hover:bg-signal hover:text-signal-foreground disabled:opacity-50"
    >
      {children}
    </button>
  );
}
