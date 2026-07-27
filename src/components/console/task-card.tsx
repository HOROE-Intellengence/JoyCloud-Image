'use client';

import { useState } from 'react';
import { TASK_TIMEOUT_MS, type ImageTask, type PreviewImage } from '@/lib/tasks';
import { downloadFile, formatMinSec } from '@/lib/format';
import { cn } from '@/lib/utils';

interface TaskCardProps {
  task: ImageTask;
  /** 展示编号：#01 或 #01-2 */
  label: string;
  fileName: string;
  staggerIndex: number;
  /** 由上层统一驱动的时钟，用于倒计时（避免每张卡各起一个定时器） */
  now: number;
  /** 排队卡片显示「队列前方 N 张」 */
  queueAhead: number;
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
  queueAhead,
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

  // ── 排队中 / 等待重试 ────────────────────────────────────
  if (task.status === 'queued') {
    const waitingRetry = task.attempt > 0;
    return (
      <Shell tone="idle" prompt={task.prompt}>
        <Slug tone="quiet">{label}</Slug>
        <Status
          heading={waitingRetry ? '等待重试' : '排队中'}
          headingTone="text-muted-foreground"
          detail={
            waitingRetry
              ? `第 ${task.attempt + 1} 次 · 等待重新入列`
              : queueAhead > 0
                ? `队列前方 ${queueAhead} 张`
                : '等待并发槽位'
          }
        />
        <GhostAction onClick={() => onCancel(task.id)}>移出队列</GhostAction>
      </Shell>
    );
  }

  // ── 生成中（含单张无进展倒计时 + 单点中断）──────────────────
  if (task.status === 'running') {
    const elapsed = task.startedAt ? Math.max(0, now - task.startedAt) : 0;
    // 超时口径是「无进展时长」：每来一个上游进展事件就重新计时
    const sinceProgress = task.lastProgressAt
      ? Math.max(0, now - task.lastProgressAt)
      : elapsed;
    const remaining = Math.max(0, TASK_TIMEOUT_MS - sinceProgress);
    const progress = Math.min(100, (sinceProgress / TASK_TIMEOUT_MS) * 100);
    const nearTimeout = remaining < TASK_TIMEOUT_MS * 0.15;

    return (
      <Shell tone="running" prompt={task.prompt}>
        <div className="flex items-center justify-between gap-2">
          <Slug tone="signal">{label}</Slug>
          <span className="size-[7px] shrink-0 rounded-full bg-signal animate-ink-pulse" />
        </div>
        <Status
          heading="生成中"
          headingTone="text-teal-deep"
          detail={`已耗时 ${formatMinSec(elapsed)} · 无进展剩余 ${formatMinSec(remaining)} · 第 ${task.attempt}/${task.maxAttempts} 次`}
        />
        <div>
          <div
            className={cn(
              'relative h-0.5 overflow-hidden',
              nearTimeout ? 'bg-rose-tint' : 'bg-teal-tint',
            )}
          >
            <div
              className={cn(
                'absolute inset-y-0 left-0 transition-[width] duration-500 ease-linear',
                nearTimeout ? 'bg-rose' : 'bg-signal',
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
          <button
            type="button"
            onClick={() => onCancel(task.id)}
            className="mt-[11px] bg-transparent text-[13px] text-muted-foreground transition-colors hover:text-rose"
          >
            中断此张
          </button>
        </div>
      </Shell>
    );
  }

  // ── 已中断 ──────────────────────────────────────────────
  if (task.status === 'cancelled') {
    return (
      <Shell tone="idle" prompt={task.prompt}>
        <div className="flex items-center justify-between gap-2">
          <Slug tone="quiet">{label}</Slug>
          <Stamp tone="text-faint">CANCELLED</Stamp>
        </div>
        <Status
          heading="已中断"
          headingTone="text-muted-foreground"
          detail="由操作员手动停止"
        />
        <GhostAction tone="teal" onClick={() => onRetry(task.id)}>
          继续生成
        </GhostAction>
      </Shell>
    );
  }

  // ── 失败（超时 / 上游拒绝）────────────────────────────────
  if (task.status === 'failed') {
    const isTimeout = task.failureKind === 'timeout';
    return (
      <Shell tone="failed" prompt={task.prompt}>
        <div className="flex items-center justify-between gap-2">
          <Slug tone="rose">{label}</Slug>
          <Stamp tone="text-rose-deep">{isTimeout ? 'TIMEOUT' : 'FAILED'}</Stamp>
        </div>
        <Status
          heading={isTimeout ? '超时未出图' : '上游拒绝'}
          headingTone="text-rose-deep"
          detail={
            isTimeout
              ? `上游 ${TIMEOUT_SECONDS}s 内无任何进展，已试 ${task.attempt}/${task.maxAttempts} 次。`
              : task.error || '生成失败，可改写提示词后重试。'
          }
        />
        <button
          type="button"
          onClick={() => onRetry(task.id)}
          className="self-start rounded-sm border border-rose bg-transparent px-3 py-[5px] text-[13px] text-rose-deep transition-colors hover:bg-rose hover:text-white"
        >
          重试此张
        </button>
      </Shell>
    );
  }

  // ── 成功：满铺样张 + 左上墨块编号 + 悬停操作层 ───────────────
  return (
    <figure
      style={{ animationDelay: `${Math.min(staggerIndex, 24) * 40}ms` }}
      className="group relative m-0 aspect-square animate-card-in overflow-hidden rounded-sm bg-sunk"
    >
      {/* 半调层自带 position:relative，用 size-full 撑满 figure，不能再叠 absolute */}
      <div className="halftone size-full">
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
      </div>

      <figcaption className="pointer-events-none absolute left-0 top-0 bg-foreground px-[9px] py-1 text-xs tracking-[0.06em] tabular-nums text-paper">
        {label}
      </figcaption>

      <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-foreground/95 via-foreground/45 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <div className="flex flex-col gap-2 p-3">
          <p className="line-clamp-2 text-xs leading-relaxed text-paper/85">
            {task.prompt}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip onClick={handleDownload} disabled={downloading}>
              {downloading ? '下载中' : '下载'}
            </Chip>
            <Chip onClick={handleCopy}>{copied ? '已复制' : '复制链接'}</Chip>
            <Chip
              onClick={() =>
                onExpand({ url: task.url, prompt: task.prompt, label, fileName })
              }
            >
              放大
            </Chip>
            <Chip onClick={() => onRetry(task.id)}>重新生成</Chip>
            {task.elapsedMs > 0 && (
              <span className="ml-auto text-[11px] tabular-nums text-paper/60">
                {(task.elapsedMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>
        </div>
      </div>
    </figure>
  );
}

/** 非成功态的卡片外壳：三段式（编号 / 状态 / 动作），靠边框语义区分 */
function Shell({
  tone,
  prompt,
  children,
}: {
  tone: 'idle' | 'running' | 'failed';
  prompt: string;
  children: React.ReactNode;
}) {
  return (
    <div
      title={prompt}
      className={cn(
        'flex aspect-square flex-col justify-between gap-3 rounded-sm border p-3.5',
        tone === 'running' && 'border-signal bg-raised',
        tone === 'failed' && 'border-rose bg-rose-wash',
        tone === 'idle' && 'border-dashed border-rule-dash bg-transparent',
      )}
    >
      {children}
    </div>
  );
}

/** 卡片编号：小字铅字条 */
function Slug({
  tone,
  children,
}: {
  tone: 'quiet' | 'signal' | 'rose';
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'text-xs tracking-[0.06em] tabular-nums',
        tone === 'quiet' && 'text-quiet',
        tone === 'signal' && 'text-teal-deep',
        tone === 'rose' && 'text-rose-deep',
      )}
    >
      {children}
    </span>
  );
}

/** 结局钢印：等宽大写标记 */
function Stamp({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className={cn('font-mono text-[11px] tracking-[0.1em]', tone)}>
      {children}
    </span>
  );
}

function Status({
  heading,
  headingTone,
  detail,
}: {
  heading: string;
  headingTone: string;
  detail: string;
}) {
  return (
    <div>
      <div className={cn('text-[17px]', headingTone)}>{heading}</div>
      <div className="mt-0.5 text-[13px] leading-[1.5] tabular-nums text-muted-foreground">
        {detail}
      </div>
    </div>
  );
}

function GhostAction({
  children,
  onClick,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: 'teal';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'self-start bg-transparent text-[13px] transition-colors hover:text-rose',
        tone === 'teal' ? 'text-teal-deep' : 'text-muted-foreground',
      )}
    >
      {children}
    </button>
  );
}

/** 悬停操作层上的动作：墨底纸字的小铅块 */
function Chip({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-sm border border-paper/35 bg-transparent px-2 py-[3px] text-[11px] text-paper/90 transition-colors hover:border-signal hover:bg-signal hover:text-white disabled:opacity-50"
    >
      {children}
    </button>
  );
}
