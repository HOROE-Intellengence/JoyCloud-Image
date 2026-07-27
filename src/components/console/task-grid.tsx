'use client';

import { useEffect, useState } from 'react';
import { ImageOff, Layers, Loader2 } from 'lucide-react';
import {
  taskLabel,
  type ImageTask,
  type PreviewImage,
  type RunPhase,
} from '@/lib/tasks';
import { safeFileName } from '@/lib/format';
import { TaskCard } from './task-card';

interface TaskGridProps {
  phase: RunPhase;
  tasks: ImageTask[];
  variantCount: number;
  /** 每批次自增，用于重置入场动画 */
  runToken: number;
  onExpand: (image: PreviewImage) => void;
  onRetry: (id: string) => void;
  onCancelTask: (id: string) => void;
}

export function TaskGrid({
  phase,
  tasks,
  variantCount,
  runToken,
  onExpand,
  onRetry,
  onCancelTask,
}: TaskGridProps) {
  // 单一时钟驱动所有卡片的超时倒计时
  const [now, setNow] = useState(0);
  const hasRunning = tasks.some((t) => t.status === 'running');

  useEffect(() => {
    if (!hasRunning) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [hasRunning]);

  if (phase === 'splitting') {
    return (
      <Centered>
        <Loader2 className="size-5 animate-spin text-signal" />
        <p className="text-[13px] text-muted-foreground">正在调用拆分 AI 分条…</p>
        <p className="text-[11px] text-faint">
          拆分完成后按条派发独立任务，每张可单独超时重试与中断
        </p>
      </Centered>
    );
  }

  if (tasks.length === 0) {
    if (phase === 'cancelled') {
      return (
        <Centered>
          <ImageOff className="size-5 text-faint" />
          <p className="text-[13px] text-muted-foreground">批次已取消</p>
          <p className="text-[11px] text-faint">修改提示词后可重新发起生成</p>
        </Centered>
      );
    }
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-md border border-dashed border-border px-6 py-14 text-center">
          <div className="flex size-10 items-center justify-center rounded-md border border-border bg-background">
            <Layers className="size-4.5 text-faint" />
          </div>
          <p className="text-[13px] text-muted-foreground">等待生产任务</p>
          <p className="max-w-[300px] text-[11px] leading-relaxed text-faint">
            在左侧填写提示词后开始生成。每条提示词会派发为一个独立任务，
            支持单张超时自动重试、单张手动重试与单点中断。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      key={runToken}
      className="grid flex-1 content-start grid-cols-2 gap-3 p-4 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
    >
      {tasks.map((task, i) => (
        <TaskCard
          key={task.id}
          task={task}
          label={taskLabel(task, variantCount)}
          fileName={safeFileName(
            task.prompt,
            task.sourceIndex,
            variantCount > 1 ? task.variant : null,
          )}
          staggerIndex={i}
          now={now}
          onExpand={onExpand}
          onRetry={onRetry}
          onCancel={onCancelTask}
        />
      ))}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="flex flex-col items-center gap-2 text-center">{children}</div>
    </div>
  );
}
