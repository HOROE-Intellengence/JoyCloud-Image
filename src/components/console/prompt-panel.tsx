'use client';

import { useMemo, useState } from 'react';
import {
  ChevronDown,
  Copy,
  Eraser,
  History,
  Loader2,
  Play,
  Plus,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { EXAMPLE_TEMPLATES } from '@/lib/examples';
import { formatClock } from '@/lib/format';
import type { InputMode } from '@/lib/prompt-text';
import { VARIANT_CHOICES, type VariantCount } from '@/lib/tasks';
import type { RunPhase } from '@/lib/tasks';
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
  const [showHistory, setShowHistory] = useState(true);

  const nonEmptyCount = useMemo(
    () => items.filter((p) => p.trim()).length,
    [items],
  );
  const charCount = useMemo(
    () =>
      mode === 'step'
        ? items.join('').trim().length
        : unifiedText.trim().length,
    [mode, items, unifiedText],
  );

  const sourceCount = mode === 'step' ? nonEmptyCount : null;
  const canStart =
    !busy && (mode === 'step' ? nonEmptyCount > 0 : unifiedText.trim().length > 0);

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

  const clearDisabled =
    busy || (mode === 'step' ? nonEmptyCount === 0 : unifiedText.length === 0);

  const plannedTasks =
    mode === 'step' ? nonEmptyCount * variantCount : null;

  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-border bg-panel lg:h-full lg:w-[400px] lg:border-b-0 lg:border-r">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] font-medium tracking-[0.14em] text-faint">
              PROMPTS INPUT
            </span>
            <span className="rounded-sm border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {sourceCount !== null
                ? `${sourceCount} 条 · ${charCount} 字符`
                : `${charCount} 字符`}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                  disabled={busy}
                >
                  示例模板
                  <ChevronDown className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {EXAMPLE_TEMPLATES.map((tpl) => (
                  <DropdownMenuItem
                    key={tpl.id}
                    onSelect={() => onApplyTemplate(tpl.text)}
                    className="text-xs"
                  >
                    {tpl.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={handleClear}
              disabled={clearDisabled}
            >
              <Eraser className="size-3" />
              清空
            </Button>
          </div>
        </div>

        {/* 输入模式：分步（默认）/ 统一 */}
        <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-background p-1">
          {(
            [
              ['step', '分步生成'],
              ['unified', '统一生成'],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              disabled={busy}
              onClick={() => onModeChange(m)}
              className={cn(
                'h-7 rounded-sm text-xs font-medium transition-colors disabled:opacity-50',
                mode === m
                  ? 'bg-signal text-signal-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'step' ? (
          <>
            <ScrollArea className="max-h-[260px] lg:max-h-[320px]">
              <div className="flex flex-col gap-2.5 pr-2">
                {items.map((item, idx) => (
                  <div key={idx} className="flex flex-col gap-1">
                    <div className="flex h-4 items-center justify-between">
                      <span className="font-mono text-[10px] tracking-wider text-faint">
                        #{String(idx + 1).padStart(2, '0')}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => duplicateItem(idx)}
                          disabled={busy}
                          aria-label={`复制第 ${idx + 1} 条`}
                          title="复制这一条"
                          className="text-faint transition-colors hover:text-foreground disabled:opacity-40"
                        >
                          <Copy className="size-3" />
                        </button>
                        {items.length > MIN_ITEMS && (
                          <button
                            type="button"
                            onClick={() => removeItem(idx)}
                            disabled={busy}
                            aria-label={`删除第 ${idx + 1} 条`}
                            className="text-faint transition-colors hover:text-destructive disabled:opacity-40"
                          >
                            <X className="size-3" />
                          </button>
                        )}
                      </div>
                    </div>
                    <Textarea
                      value={item}
                      onChange={(e) => updateItem(idx, e.target.value)}
                      disabled={busy}
                      spellCheck={false}
                      placeholder={`第 ${idx + 1} 条提示词，可跨多行粘贴长文本…`}
                      className="h-[76px] resize-none rounded-md border-input bg-background font-mono text-[13px] leading-relaxed text-foreground placeholder:text-faint focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>
                ))}
              </div>
            </ScrollArea>
            <Button
              type="button"
              variant="outline"
              onClick={addItem}
              disabled={busy}
              className="h-8 w-full gap-1.5 border-dashed text-xs text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-3.5" />
              添加一条提示词
            </Button>
          </>
        ) : (
          <Textarea
            value={unifiedText}
            onChange={(e) => onUnifiedTextChange(e.target.value)}
            disabled={busy}
            spellCheck={false}
            placeholder={
              '粘贴杂糅的图片提示词长文本，支持编号、换行等任意格式，例如：\n\n1. 一只在草地上奔跑的金毛犬，阳光明媚\n2. 未来城市的夜景，霓虹灯闪烁\n3. 一杯热气腾腾的咖啡，木质桌面，俯拍视角\n\n提交后先由上游拆分 AI 按语义分条，再按条派发独立任务。'
            }
            className="h-[240px] resize-none rounded-md border-input bg-background font-mono text-[13px] leading-relaxed text-foreground placeholder:text-faint focus-visible:ring-1 focus-visible:ring-ring lg:h-[300px]"
          />
        )}

        {/* 一生三：每条提示词生成的份数 */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              每条生成份数
            </span>
            {plannedTasks !== null && (
              <span className="font-mono text-[11px] text-faint">
                本次将派发 {plannedTasks} 个任务
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-background p-1">
            {VARIANT_CHOICES.map((n) => (
              <button
                key={n}
                type="button"
                disabled={busy}
                onClick={() => onVariantCountChange(n)}
                className={cn(
                  'h-7 rounded-sm text-xs font-medium transition-colors disabled:opacity-50',
                  variantCount === n
                    ? 'bg-signal text-signal-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {n === 1 ? '1 份 · 标准' : '3 份 · 一生三'}
              </button>
            ))}
          </div>
        </div>

        {busy ? (
          <Button
            onClick={onCancel}
            variant="outline"
            className="h-10 w-full gap-2 rounded-md border-destructive/40 bg-destructive/10 text-[13px] font-medium text-destructive hover:bg-destructive/20 hover:text-destructive"
          >
            <Square className="size-3.5 fill-current" />
            {phase === 'splitting' ? '取消拆分' : '取消批次'}
            <Loader2 className="size-3.5 animate-spin" />
          </Button>
        ) : (
          <Button
            onClick={onStart}
            disabled={!canStart}
            className="h-10 w-full gap-2 rounded-md bg-signal text-[13px] font-semibold text-signal-foreground hover:bg-signal/90 disabled:opacity-40"
          >
            <Play className="size-3.5 fill-current" />
            {variantCount > 1 ? '开始生成（一生三）' : '开始批量生成'}
            <kbd className="ml-auto rounded-sm border border-signal-foreground/25 px-1.5 py-0.5 font-mono text-[10px] text-signal-foreground/80">
              ⌘↵
            </kbd>
          </Button>
        )}

        <p className="text-[11px] leading-relaxed text-faint">
          {mode === 'step'
            ? '每个文本框即一条提示词，直接按条派发独立任务（不经拆分 AI）。'
            : '整段文本先由上游拆分 AI 分条，再按条派发独立任务。'}
          每张可单独超时重试、手动重试与中断；结果为签名 URL 约 30 天过期，请及时下载。
        </p>
      </div>

      <Separator />

      {/* 历史记录 */}
      <div className="flex min-h-0 flex-1 flex-col">
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          className="flex h-10 shrink-0 items-center gap-2 px-4 text-left"
        >
          <History className="size-3.5 text-faint" />
          <span className="font-mono text-[11px] font-medium tracking-[0.14em] text-faint">
            HISTORY
          </span>
          <span className="rounded-sm border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            {history.length}
          </span>
          <ChevronDown
            className={`ml-auto size-3.5 text-faint transition-transform ${showHistory ? '' : '-rotate-90'}`}
          />
        </button>

        {showHistory && (
          <>
            {history.length > 0 ? (
              <>
                <ScrollArea className="min-h-0 flex-1">
                  <div className="flex flex-col px-2 pb-2">
                    {history.map((entry) => (
                      <button
                        key={entry.runId}
                        type="button"
                        onClick={() => onSelectHistory(entry)}
                        className="group flex flex-col gap-1 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent"
                      >
                        <span className="line-clamp-1 text-xs text-foreground">
                          {entry.promptsPreview}
                        </span>
                        <span className="flex items-center gap-2 font-mono text-[10px] text-faint">
                          <span>{formatClock(entry.createdAt)}</span>
                          <span className="text-success">
                            {entry.output.success_count}
                          </span>
                          <span>/</span>
                          <span>{entry.output.total_count} 张</span>
                          <span className="ml-auto opacity-0 transition-opacity group-hover:opacity-100">
                            {entry.runId.slice(0, 8)}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
                <div className="shrink-0 border-t border-border p-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onClearHistory}
                    className="h-7 w-full gap-1.5 text-[11px] text-faint hover:text-destructive"
                  >
                    <Trash2 className="size-3" />
                    清除历史记录
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center px-4 pb-4">
                <p className="text-center text-[11px] leading-relaxed text-faint">
                  暂无历史记录
                  <br />
                  完成一次生成后自动保存最近 10 次运行
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
