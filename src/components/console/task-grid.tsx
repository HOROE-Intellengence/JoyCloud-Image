'use client';

import { useEffect, useMemo, useState } from 'react';
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

  /** 每张排队卡前面还压着几张，按展示顺序数 */
  const queueAhead = useMemo(() => {
    const ahead: number[] = [];
    let seen = 0;
    for (const task of tasks) {
      if (task.status === 'queued') {
        ahead.push(seen);
        seen += 1;
      } else {
        ahead.push(0);
      }
    }
    return ahead;
  }, [tasks]);

  if (phase === 'splitting') {
    return (
      <Notice
        heading="正在调用拆分模型分条"
        detail="拆分完成后按条派发独立任务，每张可单独超时重试与中断。"
        pulse
      />
    );
  }

  if (tasks.length === 0) {
    if (phase === 'cancelled') {
      return (
        <Notice
          heading="批次已取消"
          detail="修改左侧提示词后可重新发起生成。"
        />
      );
    }
    return (
      <Notice
        heading="等待进料"
        detail="在左侧写下提示词后开始生成。每条提示词派发为一个独立任务，支持单张超时自动重试、手动重试与单点中断。"
      />
    );
  }

  return (
    <div
      key={runToken}
      className="mt-[26px] grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-6"
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
          queueAhead={queueAhead[i]}
          onExpand={onExpand}
          onRetry={onRetry}
          onCancel={onCancelTask}
        />
      ))}
    </div>
  );
}

/** 空态/中间态：虚线框内一句状态与一句指引，不放假图 */
function Notice({
  heading,
  detail,
  pulse,
}: {
  heading: string;
  detail: string;
  pulse?: boolean;
}) {
  return (
    <div className="mt-[26px] rounded-sm border border-dashed border-rule-dash px-8 py-16 text-center">
      <div className="flex items-center justify-center gap-2.5">
        {pulse && (
          <span className="size-[7px] rounded-full bg-signal animate-ink-pulse" />
        )}
        <span className="text-[17px] text-muted-foreground">{heading}</span>
      </div>
      <p className="mx-auto mt-2 max-w-[420px] text-[13px] leading-relaxed text-faint">
        {detail}
      </p>
    </div>
  );
}
