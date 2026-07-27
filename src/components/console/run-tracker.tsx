'use client';

import { useState } from 'react';
import { ChevronDown, Download, RotateCcw, Square, Terminal } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  MAX_CONCURRENCY,
  MIN_CONCURRENCY,
  TASK_TIMEOUT_MS,
  type ImageTask,
  type LogEntry,
  type RunPhase,
} from '@/lib/tasks';
import { cn } from '@/lib/utils';

export interface TaskCounts {
  total: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  running: number;
  queued: number;
}

export function countTasks(tasks: ImageTask[]): TaskCounts {
  return {
    total: tasks.length,
    succeeded: tasks.filter((t) => t.status === 'succeeded').length,
    failed: tasks.filter((t) => t.status === 'failed').length,
    cancelled: tasks.filter((t) => t.status === 'cancelled').length,
    running: tasks.filter((t) => t.status === 'running').length,
    queued: tasks.filter((t) => t.status === 'queued').length,
  };
}

interface RunTrackerProps {
  phase: RunPhase;
  counts: TaskCounts;
  sourceCount: number;
  variantCount: number;
  elapsedMs: number;
  logs: LogEntry[];
  concurrency: number;
  onConcurrencyChange: (value: number) => void;
  onCancelAll: () => void;
  onRetryAllFailed: () => void;
  onDownloadAll: () => void;
  downloadingAll: boolean;
  downloadProgress: { done: number; total: number } | null;
}

function formatElapsed(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(1).padStart(4, '0');
  return minutes > 0 ? `${minutes}:${seconds}` : `${seconds}s`;
}

export function RunTracker({
  phase,
  counts,
  sourceCount,
  variantCount,
  elapsedMs,
  logs,
  concurrency,
  onConcurrencyChange,
  onCancelAll,
  onRetryAllFailed,
  onDownloadAll,
  downloadingAll,
  downloadProgress,
}: RunTrackerProps) {
  const [showLogs, setShowLogs] = useState(false);
  const active = phase === 'running' || phase === 'splitting';
  const settled = counts.succeeded + counts.failed + counts.cancelled;
  const progress =
    counts.total > 0 ? Math.round((settled / counts.total) * 100) : 0;
  const retryable = counts.failed + counts.cancelled;

  return (
    <section className="border-b border-border bg-panel">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        {/* 批次构成 */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-medium tracking-[0.14em] text-faint">
            TASKS
          </span>
          <span className="rounded-sm border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            {sourceCount} 条 × {variantCount} 份 = {counts.total}
          </span>
        </div>

        {/* 进度条 */}
        <div className="flex min-w-[140px] flex-1 items-center gap-2">
          <div className="h-1.5 min-w-[80px] flex-1 overflow-hidden rounded-sm bg-muted">
            <div
              className="h-full bg-signal transition-[width] duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {settled}/{counts.total}
          </span>
        </div>

        <Stat label="成功" value={counts.succeeded} tone="text-success" />
        <Stat
          label="失败"
          value={counts.failed}
          tone={counts.failed > 0 ? 'text-destructive' : undefined}
        />
        {counts.cancelled > 0 && (
          <Stat label="中断" value={counts.cancelled} tone="text-faint" />
        )}
        <Stat label="生成中" value={counts.running} tone="text-signal" />
        <Stat label="排队" value={counts.queued} />

        {elapsedMs > 0 && (
          <span
            className={cn(
              'font-mono text-[13px] tabular-nums',
              active ? 'text-signal' : 'text-muted-foreground',
            )}
          >
            {formatElapsed(elapsedMs)}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* 并发槽位 */}
          <label className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
            <span className="text-[11px] text-faint">并发</span>
            <input
              type="number"
              min={MIN_CONCURRENCY}
              max={MAX_CONCURRENCY}
              value={concurrency}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (!Number.isFinite(next)) return;
                onConcurrencyChange(
                  Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, Math.round(next))),
                );
              }}
              className="w-8 bg-transparent text-center font-mono text-[11px] text-foreground outline-none"
            />
          </label>

          <span
            className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-faint"
            title="单张连续无上游进展事件超过该时长即判卡死，中断并自动重试（ping 心跳不算进展）"
          >
            无进展超时 {Math.round(TASK_TIMEOUT_MS / 1000)}s
          </span>

          {active && (
            <button
              type="button"
              onClick={onCancelAll}
              className="flex h-7 items-center gap-1.5 rounded-md border border-destructive/40 px-2.5 text-[11px] text-destructive transition-colors hover:bg-destructive/10"
            >
              <Square className="size-2.5 fill-current" />
              取消批次
            </button>
          )}

          {retryable > 0 && (
            <button
              type="button"
              onClick={onRetryAllFailed}
              className="flex h-7 items-center gap-1.5 rounded-md border border-destructive/40 px-2.5 text-[11px] text-destructive transition-colors hover:bg-destructive/10"
            >
              <RotateCcw className="size-3" />
              重试全部未完成 ({retryable})
            </button>
          )}

          <button
            type="button"
            onClick={onDownloadAll}
            disabled={downloadingAll || counts.succeeded === 0}
            className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[11px] text-foreground transition-colors hover:border-signal/60 hover:text-signal disabled:opacity-50"
          >
            <Download className="size-3" />
            {downloadingAll && downloadProgress
              ? `下载中 ${downloadProgress.done}/${downloadProgress.total}`
              : `全部下载 (${counts.succeeded})`}
          </button>

          <button
            type="button"
            onClick={() => setShowLogs((v) => !v)}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 font-mono text-[11px] transition-colors',
              showLogs ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Terminal className="size-3" />
            日志
            <ChevronDown
              className={cn('size-3 transition-transform', showLogs && 'rotate-180')}
            />
          </button>
        </div>
      </div>

      {showLogs && (
        <div className="border-t border-border">
          <ScrollArea className="h-[160px]">
            <div className="flex flex-col gap-0.5 px-4 py-2 font-mono text-[11px]">
              {logs.length === 0 ? (
                <span className="text-faint">等待运行…</span>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="flex gap-2 leading-5">
                    <span className="shrink-0 text-faint">{log.time}</span>
                    <span
                      className={cn(
                        log.tone === 'ok' && 'text-success',
                        log.tone === 'err' && 'text-destructive',
                        log.tone === 'amber' && 'text-signal',
                        log.tone === 'info' && 'text-muted-foreground',
                      )}
                    >
                      {log.text}
                    </span>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[11px] text-faint">{label}</span>
      <span className={cn('font-mono text-[13px] tabular-nums', tone ?? 'text-foreground')}>
        {value}
      </span>
    </div>
  );
}
