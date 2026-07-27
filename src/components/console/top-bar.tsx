'use client';

import { useEffect, useState } from 'react';
import { MAX_CONCURRENCY, TASK_TIMEOUT_MS, type VariantCount } from '@/lib/tasks';
import type { InputMode } from '@/lib/prompt-text';
import { cn } from '@/lib/utils';
import { UserSelector } from './user-selector';

interface TopBarProps {
  /** 是否有批次在跑（拆分中/生成中） */
  active: boolean;
  userId: string;
  onUserChange: (userId: string) => void;
  /** 铅字条：当前批次号，无批次时显示待进料 */
  batchId: string | null;
  mode: InputMode;
  variantCount: VariantCount;
  /**
   * 并发输入框的**原始文本**（受控）：不再限制只能填数字——
   * 既要允许填超过上限的数（实际按 MAX_CONCURRENCY 执行），
   * 也是隐藏后台暗号的入口（见 lib/admin.ts）。
   */
  concurrencyText: string;
  onConcurrencyTextChange: (value: string) => void;
  /** 解析后的填写值；> MAX_CONCURRENCY 时铅字条上标注实际执行值 */
  concurrency: number;
}

type ServiceStatus = 'checking' | 'ok' | 'down' | 'unselected';

const TIMEOUT_SECONDS = Math.round(TASK_TIMEOUT_MS / 1000);

const STATUS_TEXT: Record<ServiceStatus, string> = {
  checking: '正在探测上游',
  ok: '上游服务正常',
  down: '上游服务异常',
  unselected: '未选择用户',
};

export function TopBar({
  active,
  userId,
  onUserChange,
  batchId,
  mode,
  variantCount,
  concurrencyText,
  onConcurrencyTextChange,
  concurrency,
}: TopBarProps) {
  const [service, setService] = useState<ServiceStatus>('checking');
  /** 探活往返耗时，取代硬编码延迟；探测失败时为 null */
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  /** 出版日期在挂载后才渲染，避免服务端/客户端时区不一致导致 hydration 报错 */
  const [pressDate, setPressDate] = useState('');

  useEffect(() => {
    const now = new Date();
    setPressDate(
      `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日`,
    );
  }, []);

  useEffect(() => {
    // 未选择用户时不去探活：上游对无 Token 请求必然 401，探活结果没有参考价值
    if (!userId) {
      setService('unselected');
      setLatencyMs(null);
      return;
    }
    let alive = true;
    setService('checking');
    const check = async () => {
      const startedAt = performance.now();
      try {
        const resp = await fetch(
          `/api/health?user_id=${encodeURIComponent(userId)}`,
          { cache: 'no-store' },
        );
        const data = (await resp.json()) as { status?: string };
        if (!alive) return;
        setService(data.status === 'ok' ? 'ok' : 'down');
        setLatencyMs(Math.round(performance.now() - startedAt));
      } catch {
        if (!alive) return;
        setService('down');
        setLatencyMs(null);
      }
    };
    check();
    const timer = setInterval(check, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [userId]);

  const statusText = active ? '批次运行中' : STATUS_TEXT[service];
  const dotClass = active
    ? 'bg-signal animate-ink-pulse'
    : service === 'ok'
      ? 'bg-signal'
      : service === 'down'
        ? 'bg-rose'
        : service === 'checking'
          ? 'bg-faint animate-ink-pulse'
          : 'bg-faint';

  return (
    <header className="pt-[26px] font-sans">
      <div className="flex flex-wrap items-baseline justify-between gap-x-10 gap-y-3">
        <div className="flex items-baseline gap-3.5">
          <h1 className="m-0 text-2xl font-semibold leading-none tracking-[0.01em]">
            云悦工作台
          </h1>
          <span className="text-[13px] tracking-[0.04em] text-quiet">
            JoyCloud Image Press
          </span>
        </div>

        <div className="flex items-center gap-7">
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <span className={cn('size-[7px] rounded-full', dotClass)} />
            <span>{statusText}</span>
            {latencyMs !== null && (
              <span className="tabular-nums text-quiet">
                · 延迟 {latencyMs}ms
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <span className="text-xs tracking-[0.04em] text-quiet">操作员</span>
            <UserSelector userId={userId} onChange={onUserChange} />
          </div>
        </div>
      </div>

      <div className="mt-3.5 h-px bg-foreground" />

      <div className="flex flex-wrap items-center gap-x-7 gap-y-1 py-2 text-xs tracking-[0.04em] text-muted-foreground">
        <span>
          批次{' '}
          <span className="font-mono tabular-nums">
            {batchId ?? '尚未进料'}
          </span>
        </span>
        <span>
          {mode === 'step' ? '分步生成' : '统一生成'} · 每条 {variantCount} 份
        </span>
        <label
          className="flex items-center gap-1"
          title={`同时在跑的任务数；可以填任意值，超过 ${MAX_CONCURRENCY} 时实际按 ${MAX_CONCURRENCY} 执行`}
        >
          <span>并发</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            value={concurrencyText}
            aria-label="并发槽位"
            onChange={(e) => onConcurrencyTextChange(e.target.value)}
            className="w-12 border-b border-dotted border-rule-dash bg-transparent text-center tabular-nums text-foreground outline-none transition-colors hover:border-signal focus:border-signal"
          />
          {concurrency > MAX_CONCURRENCY && (
            <span className="text-quiet">· 实际按 {MAX_CONCURRENCY} 执行</span>
          )}
          <span>· 单张无进展超时 {TIMEOUT_SECONDS}s</span>
        </label>
        <span className="ml-auto tabular-nums">{pressDate}</span>
      </div>

      <div className="h-px bg-rule" />
    </header>
  );
}
