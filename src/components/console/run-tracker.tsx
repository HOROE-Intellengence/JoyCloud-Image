'use client';

import { useState } from 'react';
import { formatMinSec } from '@/lib/format';
import type { ImageTask, LogEntry, RunPhase } from '@/lib/tasks';
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
  elapsedMs: number;
  logs: LogEntry[];
  onRetryAllFailed: () => void;
  onDownloadAll: () => void;
  downloadingAll: boolean;
  downloadProgress: { done: number; total: number } | null;
}

export function RunTracker({
  phase,
  counts,
  elapsedMs,
  logs,
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

  // 预计剩余：用已落地任务的平均墙钟时间推算，样本不足或已收工时不显示
  const remainingMs =
    active && settled > 0 && settled < counts.total
      ? (elapsedMs / settled) * (counts.total - settled)
      : null;

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div>
          <h2 className="m-0 mb-1.5 text-[19px] font-semibold">
            本批次 · {counts.total > 0 ? `${counts.total} 张` : '尚未进料'}
          </h2>
          <div className="flex flex-wrap items-baseline gap-x-[18px] gap-y-1 text-sm tabular-nums text-muted-foreground">
            <Count value={counts.succeeded} label="成功" tone="text-foreground" />
            <Count value={counts.running} label="生成中" tone="text-signal" />
            <Count
              value={counts.queued}
              label="排队"
              tone="text-muted-foreground"
            />
            <Count value={counts.failed} label="失败" tone="text-rose" />
            <Count value={counts.cancelled} label="中断" tone="text-quiet" />
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-5 whitespace-nowrap text-sm">
          <button
            type="button"
            onClick={() => setShowLogs((v) => !v)}
            className={cn(
              'bg-transparent transition-colors hover:text-rose',
              showLogs ? 'text-foreground' : 'text-teal-deep',
            )}
          >
            运行日志
          </button>
          {retryable > 0 && (
            <button
              type="button"
              onClick={onRetryAllFailed}
              className="bg-transparent text-teal-deep transition-colors hover:text-rose"
            >
              重试全部失败
            </button>
          )}
          <button
            type="button"
            onClick={onDownloadAll}
            disabled={downloadingAll || counts.succeeded === 0}
            className="rounded-sm border border-foreground bg-transparent px-4 py-[7px] text-foreground transition-colors hover:bg-foreground hover:text-paper disabled:cursor-not-allowed disabled:border-rule-dash disabled:text-rule-dash disabled:hover:bg-transparent disabled:hover:text-rule-dash"
          >
            {downloadingAll && downloadProgress
              ? `下载中 ${downloadProgress.done}/${downloadProgress.total}`
              : '全部下载'}
          </button>
        </div>
      </div>

      <div className="relative mt-3.5 h-0.5 overflow-hidden bg-rule-soft">
        <div
          className={cn(
            'absolute inset-y-0 left-0 bg-signal transition-[width] duration-300 ease-out',
            active && 'press-stripe',
          )}
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex justify-between gap-4 pt-1.5 text-xs uppercase tracking-[0.1em] tabular-nums text-quiet">
        <span>已完成 {progress}%</span>
        <span>
          已耗时 {formatMinSec(elapsedMs)}
          {remainingMs !== null && ` · 预计剩余 ${formatMinSec(remainingMs)}`}
        </span>
      </div>

      {showLogs && (
        <div className="mt-4 max-h-56 overflow-y-auto rounded-sm bg-sunk px-[18px] py-3.5 font-mono text-xs leading-[1.9] text-muted-foreground">
          {logs.length === 0 ? (
            <div className="text-faint">等待运行…</div>
          ) : (
            logs.map((log) => (
              <div key={log.id}>
                <span className="text-quiet">{log.time}</span>
                {' · '}
                <span
                  className={cn(
                    log.tone === 'ok' && 'text-teal-deep',
                    log.tone === 'err' && 'text-rose-deep',
                    log.tone === 'amber' && 'text-signal',
                  )}
                >
                  {log.text}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}

function Count({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: string;
}) {
  return (
    <span>
      <span className={tone}>{value}</span> {label}
    </span>
  );
}
