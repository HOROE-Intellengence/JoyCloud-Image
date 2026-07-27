'use client';

import { useMemo } from 'react';
import { EXAMPLE_TEMPLATES } from '@/lib/examples';
import type { InputMode } from '@/lib/prompt-text';
import { VARIANT_CHOICES, type RunPhase, type VariantCount } from '@/lib/tasks';
import { cn } from '@/lib/utils';
import type { RunHistoryEntry } from '@/hooks/use-run-history';

interface PromptPanelProps {
  mode: InputMode;
  onModeChange: (mode: InputMode) => void;
  /** 分步模式的条目（受控） */
  items: string[];
  onItemsChange: (items: string[]) => void;
  /** 统一模式的整段文本（受控） */
  unifiedText: string;
  onUnifiedTextChange: (text: string) => void;
  /** 一生三：每条提示词生成几份 */
  variantCount: VariantCount;
  onVariantCountChange: (n: VariantCount) => void;
  phase: RunPhase;
  onStart: () => void;
  onCancel: () => void;
  onApplyTemplate: (text: string) => void;
  history: RunHistoryEntry[];
  onSelectHistory: (entry: RunHistoryEntry) => void;
  onClearHistory: () => void;
}

const MIN_ITEMS = 1;

/** 最近运行的时间戳：当天与前一天用「今日 / 昨日」，更早用月-日 */
function formatRunTime(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const dayDiff = Math.floor(
    (startOfToday.getTime() - d.getTime()) / 86_400_000,
  );
  if (dayDiff < 0) return `今日 ${clock}`;
  if (dayDiff === 0) return `昨日 ${clock}`;
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${clock}`;
}

export function PromptPanel({
  mode,
  onModeChange,
  items,
  onItemsChange,
  unifiedText,
  onUnifiedTextChange,
  variantCount,
  onVariantCountChange,
  phase,
  onStart,
  onCancel,
  onApplyTemplate,
  history,
  onSelectHistory,
  onClearHistory,
}: PromptPanelProps) {
  const busy = phase === 'running' || phase === 'splitting';

  const nonEmptyCount = useMemo(
    () => items.filter((p) => p.trim()).length,
    [items],
  );

  const canStart =
    !busy &&
    (mode === 'step' ? nonEmptyCount > 0 : unifiedText.trim().length > 0);
  const clearDisabled =
    busy || (mode === 'step' ? nonEmptyCount === 0 : unifiedText.length === 0);

  const updateItem = (index: number, next: string) => {
    onItemsChange(items.map((p, i) => (i === index ? next : p)));
  };
  const addItem = () => onItemsChange([...items, '']);
  const removeItem = (index: number) => {
    if (items.length <= MIN_ITEMS) return;
    onItemsChange(items.filter((_, i) => i !== index));
  };
  const duplicateItem = (index: number) => {
    const next = [...items];
    next.splice(index + 1, 0, items[index]);
    onItemsChange(next);
  };

  const handleClear = () => {
    if (mode === 'step') {
      onItemsChange(['', '', '', '', '']);
    } else {
      onUnifiedTextChange('');
    }
  };

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-[19px] font-semibold">生产区</h2>
        <button
          type="button"
          onClick={handleClear}
          disabled={clearDisabled}
          className="text-[13px] text-teal-deep transition-colors hover:text-rose disabled:text-rule-dash disabled:hover:text-rule-dash"
        >
          清空
        </button>
      </div>
      <p className="mb-5 mt-1 text-sm text-muted-foreground">
        一行一条提示词，编号即成品序号。
      </p>

      <Segmented
        disabled={busy}
        value={mode}
        onChange={onModeChange}
        className="mb-[22px]"
        options={[
          { value: 'step', label: '分步生成' },
          { value: 'unified', label: '统一生成' },
        ]}
      />

      {mode === 'step' ? (
        <>
          <div className="flex max-h-[330px] flex-col gap-0.5 overflow-y-auto pr-1">
            {items.map((item, idx) => (
              <div
                key={idx}
                className="group grid grid-cols-[26px_minmax(0,1fr)_30px] items-start gap-x-2.5 border-b border-rule-soft py-[9px]"
              >
                <span
                  className={cn(
                    'pt-0.5 text-[13px] tabular-nums',
                    item.trim() ? 'text-signal' : 'text-rule-dash',
                  )}
                >
                  {String(idx + 1).padStart(2, '0')}
                </span>
                <textarea
                  value={item}
                  onChange={(e) => updateItem(idx, e.target.value)}
                  disabled={busy}
                  spellCheck={false}
                  rows={2}
                  placeholder={`写下第 ${idx + 1} 条…`}
                  className="max-h-32 w-full resize-none overflow-y-auto bg-transparent text-[15px] leading-[1.5] text-foreground outline-none field-sizing-content placeholder:italic placeholder:text-faint disabled:opacity-60"
                />
                <div className="flex flex-col items-end gap-1 pt-0.5 text-[11px] opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => duplicateItem(idx)}
                    disabled={busy}
                    title={`复制第 ${idx + 1} 条`}
                    className="text-quiet transition-colors hover:text-signal disabled:opacity-40"
                  >
                    复制
                  </button>
                  {items.length > MIN_ITEMS && (
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      disabled={busy}
                      title={`删除第 ${idx + 1} 条`}
                      className="text-quiet transition-colors hover:text-rose disabled:opacity-40"
                    >
                      删除
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addItem}
            disabled={busy}
            className="mt-2.5 w-full rounded-sm border border-dashed border-rule-dash bg-transparent py-[9px] text-sm text-muted-foreground transition-colors hover:border-signal hover:text-signal disabled:opacity-50 disabled:hover:border-rule-dash disabled:hover:text-muted-foreground"
          >
            ＋ 追加一条
          </button>
        </>
      ) : (
        <textarea
          value={unifiedText}
          onChange={(e) => onUnifiedTextChange(e.target.value)}
          disabled={busy}
          spellCheck={false}
          placeholder="粘贴整段提示词，系统会交由拆分模型分条；若拆分不可用，将询问是否本地分条。"
          className="min-h-[300px] w-full resize-y rounded-sm border border-rule bg-raised px-4 py-3.5 text-[15px] leading-[1.6] text-foreground outline-none transition-colors placeholder:italic placeholder:text-faint focus:border-signal disabled:opacity-60"
        />
      )}

      <div className="mt-[26px]">
        <div className="mb-2.5 flex items-baseline justify-between gap-3">
          <span className="text-xs uppercase tracking-[0.14em] text-quiet">
            每条份数
          </span>
          {mode === 'step' && nonEmptyCount > 0 && (
            <span className="text-xs tabular-nums text-quiet">
              本次派发 {nonEmptyCount * variantCount} 个任务
            </span>
          )}
        </div>
        <Segmented
          disabled={busy}
          value={variantCount}
          onChange={onVariantCountChange}
          compact
          options={VARIANT_CHOICES.map((n) => ({
            value: n,
            label: n === 1 ? '1 份' : '3 份 · 一生三',
          }))}
        />
      </div>

      <div className="mt-6">
        <div className="mb-2.5 text-xs uppercase tracking-[0.14em] text-quiet">
          示例模板
        </div>
        <div className="flex flex-wrap gap-2">
          {EXAMPLE_TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              disabled={busy}
              onClick={() => onApplyTemplate(tpl.text)}
              className="rounded-sm bg-teal-wash px-2.5 py-1 text-[13px] text-teal-deep transition-colors hover:bg-teal-tint disabled:opacity-50 disabled:hover:bg-teal-wash"
            >
              {tpl.name}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={onStart}
        disabled={!canStart}
        className="mt-7 w-full rounded-sm bg-signal py-[13px] text-base tracking-[0.02em] text-signal-foreground transition-colors hover:bg-teal-deep disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-signal"
      >
        {busy
          ? phase === 'splitting'
            ? '正在拆分…'
            : '正在生成…'
          : variantCount > 1
            ? '开始生成（一生三）'
            : '开始批量生成'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={!busy}
        className="mt-2 w-full bg-transparent py-[9px] text-sm text-muted-foreground transition-colors hover:text-rose disabled:text-rule-dash disabled:hover:text-rule-dash"
      >
        {phase === 'splitting' ? '取消拆分' : '取消批次'}
      </button>

      <p className="mt-3 text-[13px] italic leading-relaxed text-quiet">
        ⌘↵ / Ctrl↵ 直接开始。成品为签名链接，约 30 天后过期，请及时下载。
      </p>

      <div className="mt-[34px]">
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <span className="text-xs uppercase tracking-[0.14em] text-quiet">
            最近运行
          </span>
          {history.length > 0 && (
            <button
              type="button"
              onClick={onClearHistory}
              className="text-xs text-teal-deep transition-colors hover:text-rose"
            >
              清除
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <p className="py-2 text-[13px] italic text-faint">
            完成一次生成后自动留存最近 10 次运行，可回放并对单张重新生成。
          </p>
        ) : (
          <div className="flex flex-col">
            {history.map((entry) => (
              <button
                key={entry.runId}
                type="button"
                onClick={() => onSelectHistory(entry)}
                title={entry.promptsPreview}
                className="group flex items-baseline justify-between gap-3 border-b border-rule-soft py-2 text-left"
              >
                <span className="truncate text-sm transition-colors group-hover:text-teal-deep">
                  {entry.promptsPreview} · {entry.output.total_count} 张
                </span>
                <span className="shrink-0 text-xs tabular-nums text-quiet">
                  {formatRunTime(entry.createdAt)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 铅字分段控件：一条 1px 墨黑外框切两半，选中的一半整块上墨 */
function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  disabled,
  compact,
  className,
}: {
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string }[];
  disabled?: boolean;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 overflow-hidden rounded-sm border border-foreground',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'border-0 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60',
              compact ? 'py-[7px]' : 'py-2',
              active
                ? 'bg-foreground text-paper'
                : 'bg-transparent text-muted-foreground hover:text-signal disabled:hover:text-muted-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
