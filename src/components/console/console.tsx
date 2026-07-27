'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useTaskRunner } from '@/hooks/use-task-runner';
import { useRunHistory, type RunHistoryEntry } from '@/hooks/use-run-history';
import { downloadFile, safeFileName } from '@/lib/format';
import {
  composeStepItems,
  localSplitPrompts,
  parseNumberedList,
  type InputMode,
} from '@/lib/prompt-text';
import {
  DEFAULT_CONCURRENCY,
  MIN_CONCURRENCY,
  isVariantCount,
  tasksToOutput,
  type PreviewImage,
  type VariantCount,
} from '@/lib/tasks';
import { isAdminCode } from '@/lib/admin';
import { DEFAULT_USER_ID, WORKFLOW_USERS, isValidUserId } from '@/lib/users';
import { cn } from '@/lib/utils';
import { AdminPanel } from './admin-panel';
import { TopBar } from './top-bar';
import { UserBadge } from './user-selector';
import { PromptPanel } from './prompt-panel';
import { RunTracker, countTasks } from './run-tracker';
import { TaskGrid } from './task-grid';
import { Lightbox } from './lightbox';

const EMPTY_STEP_ITEMS = ['', '', '', '', ''];
const USER_STORAGE_KEY = 'image-mill:user';
const VARIANT_STORAGE_KEY = 'image-mill:variant-count';

export function Console() {
  const {
    state,
    concurrency,
    setConcurrency,
    start,
    startWithSplit,
    cancelTask,
    cancelAll,
    retryTask,
    retryAllFailed,
    loadOutput,
  } = useTaskRunner();
  const { history, addEntry, clearHistory } = useRunHistory();

  // 输入（受控，供任务引擎直接取用）
  const [mode, setMode] = useState<InputMode>('step');
  const [items, setItems] = useState<string[]>([...EMPTY_STEP_ITEMS]);
  const [unifiedText, setUnifiedText] = useState('');
  const [variantCount, setVariantCount] = useState<VariantCount>(1);

  const [userId, setUserId] = useState<string>(DEFAULT_USER_ID);
  const [identityPromptOpen, setIdentityPromptOpen] = useState(false);
  /** 并发输入框的原始文本：可以填超过上限的数，也是隐藏后台的入口 */
  const [concurrencyText, setConcurrencyText] = useState(
    String(DEFAULT_CONCURRENCY),
  );
  const [adminOpen, setAdminOpen] = useState(false);
  const [splitFallback, setSplitFallback] = useState<{
    reason: string;
    text: string;
  } | null>(null);

  const [expanded, setExpanded] = useState<PreviewImage | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [runToken, setRunToken] = useState(0);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [downloadTipOpen, setDownloadTipOpen] = useState(false);

  const archivedRef = useRef<string | null>(null);

  // 挂载后恢复上次选择
  useEffect(() => {
    try {
      const savedUser = window.localStorage.getItem(USER_STORAGE_KEY);
      if (savedUser && isValidUserId(savedUser)) setUserId(savedUser);
      const savedVariant = Number(
        window.localStorage.getItem(VARIANT_STORAGE_KEY),
      );
      if (isVariantCount(savedVariant)) setVariantCount(savedVariant);
    } catch {
      // 存储不可用时保持默认
    }
  }, []);

  const handleUserChange = useCallback((next: string) => {
    setUserId(next);
    try {
      window.localStorage.setItem(USER_STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  /**
   * 并发框改动：前端不再设上限（超过 10 由调度器按 10 执行），
   * 非数字文本（暗号）保留在框里但不动调度器。
   */
  const handleConcurrencyTextChange = useCallback(
    (raw: string) => {
      setConcurrencyText(raw);
      const next = Number(raw.trim());
      if (!Number.isFinite(next) || next < MIN_CONCURRENCY) return;
      setConcurrency(Math.floor(next));
    },
    [setConcurrency],
  );

  const handleVariantChange = useCallback((next: VariantCount) => {
    setVariantCount(next);
    try {
      window.localStorage.setItem(VARIANT_STORAGE_KEY, String(next));
    } catch {
      // ignore
    }
  }, []);

  // 运行计时器
  const active = state.phase === 'running' || state.phase === 'splitting';
  useEffect(() => {
    if (!active || state.startedAt === null) {
      if (state.startedAt === null) {
        // 历史回放等场景没有本地计时起点，清零避免显示上一批的耗时
        setElapsedMs(0);
      } else if (state.endedAt !== null) {
        setElapsedMs(state.endedAt - state.startedAt);
      }
      return;
    }
    setElapsedMs(Date.now() - state.startedAt);
    const timer = setInterval(() => {
      setElapsedMs(Date.now() - (state.startedAt ?? Date.now()));
    }, 100);
    return () => clearInterval(timer);
  }, [active, state.startedAt, state.endedAt]);

  const counts = useMemo(() => countTasks(state.tasks), [state.tasks]);

  // 批次落地后归档历史；同一批次结果变化（手动重试成功等）时覆盖同一条记录
  useEffect(() => {
    if (state.phase !== 'done' || !state.batchId || state.tasks.length === 0) {
      return;
    }
    const key = `${state.batchId}:${counts.succeeded}:${counts.failed}:${counts.cancelled}`;
    if (archivedRef.current === key) return;
    archivedRef.current = key;
    addEntry(
      state.submittedText,
      tasksToOutput(state.tasks, state.batchId),
      state.batchId,
    );
  }, [
    state.phase,
    state.batchId,
    state.tasks,
    state.submittedText,
    counts.succeeded,
    counts.failed,
    counts.cancelled,
    addEntry,
  ]);

  /** 外部文本写入输入区（示例模板 / 历史回放）：编号列表回填分步框，否则走统一模式 */
  const applyExternalText = useCallback((text: string) => {
    const parsed = parseNumberedList(text);
    if (parsed) {
      setItems(parsed);
      setMode('step');
      setUnifiedText('');
    } else {
      setUnifiedText(text);
      setMode('unified');
    }
  }, []);

  const launch = useCallback(
    (prompts: string[], submittedText: string, runUserId: string) => {
      setRunToken((t) => t + 1);
      start({ prompts, userId: runUserId, variantCount, submittedText });
    },
    [start, variantCount],
  );

  /** 以指定用户身份发起一次批次 */
  const runWith = useCallback(
    async (runUserId: string) => {
      if (mode === 'step') {
        const prompts = items
          .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
          .filter(Boolean);
        if (prompts.length === 0) return;
        launch(prompts, composeStepItems(items), runUserId);
        return;
      }

      const text = unifiedText.trim();
      if (!text) return;
      setRunToken((t) => t + 1);
      const result = await startWithSplit(text, runUserId, variantCount);
      if (!result.ok && result.error !== '已取消') {
        // 拆分 AI 不可用时不静默降级，交给用户决定是否按本地规则分条
        setSplitFallback({ reason: result.error ?? '拆分失败', text });
      }
    },
    [mode, items, unifiedText, variantCount, launch, startWithSplit],
  );

  const handleStart = useCallback(() => {
    // 后台暗号：并发框里键入暗号后再点生成 = 开后台，这一次点击不派发任何任务。
    // 放在身份守卫之前——进后台是看账，与用谁的 key 无关。
    if (isAdminCode(concurrencyText)) {
      setConcurrencyText(String(concurrency));
      setAdminOpen(true);
      return;
    }
    // 强制身份守卫：上游对无 Token 请求直接 401，没有可用的兜底链路
    if (!userId) {
      setIdentityPromptOpen(true);
      return;
    }
    void runWith(userId);
  }, [concurrencyText, concurrency, userId, runWith]);

  /** 弹窗内选人：记住选择并立即以该身份开始生成 */
  const handlePickUser = useCallback(
    (id: string) => {
      handleUserChange(id);
      setIdentityPromptOpen(false);
      void runWith(id);
    },
    [handleUserChange, runWith],
  );

  const handleSplitFallbackConfirm = useCallback(() => {
    const pending = splitFallback;
    setSplitFallback(null);
    if (!pending || !userId) return;
    const prompts = localSplitPrompts(pending.text);
    if (prompts.length === 0) return;
    launch(prompts, pending.text, userId);
  }, [splitFallback, launch, userId]);

  const handleDownloadAll = useCallback(async () => {
    const successes = state.tasks.filter(
      (t) => t.status === 'succeeded' && t.url,
    );
    if (successes.length === 0 || downloadingAll) return;
    setDownloadingAll(true);
    setDownloadTipOpen(true);
    setDownloadProgress({ done: 0, total: successes.length });
    for (const task of successes) {
      try {
        await downloadFile(
          task.url,
          safeFileName(
            task.prompt,
            task.sourceIndex,
            state.variantCount > 1 ? task.variant : null,
          ),
        );
      } catch {
        // 单张失败继续下一张
      }
      setDownloadProgress((prev) =>
        prev ? { ...prev, done: prev.done + 1 } : prev,
      );
    }
    setDownloadingAll(false);
    setTimeout(() => setDownloadProgress(null), 1500);
  }, [state.tasks, state.variantCount, downloadingAll]);

  const handleSelectHistory = useCallback(
    (entry: RunHistoryEntry) => {
      applyExternalText(entry.promptsText);
      archivedRef.current = null;
      setRunToken((t) => t + 1);
      loadOutput(entry.output, entry.promptsText);
    },
    [applyExternalText, loadOutput],
  );

  // ⌘/Ctrl + Enter 快捷启动
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!active && !adminOpen) handleStart();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleStart, active, adminOpen]);

  return (
    <div className="min-h-dvh bg-background px-5 pb-[60px] text-foreground lg:px-10">
      <TopBar
        active={active}
        userId={userId}
        onUserChange={handleUserChange}
        batchId={state.batchId}
        mode={mode}
        variantCount={variantCount}
        concurrencyText={concurrencyText}
        onConcurrencyTextChange={handleConcurrencyTextChange}
        concurrency={concurrency}
      />

      <div className="grid items-start gap-10 pt-[30px] lg:grid-cols-[400px_minmax(0,1fr)] lg:gap-14">
        <aside className="lg:sticky lg:top-6">
          <PromptPanel
            mode={mode}
            onModeChange={setMode}
            items={items}
            onItemsChange={setItems}
            unifiedText={unifiedText}
            onUnifiedTextChange={setUnifiedText}
            variantCount={variantCount}
            onVariantCountChange={handleVariantChange}
            phase={state.phase}
            onStart={handleStart}
            onCancel={cancelAll}
            onApplyTemplate={applyExternalText}
            history={history}
            onSelectHistory={handleSelectHistory}
            onClearHistory={clearHistory}
          />
        </aside>

        <main>
          <RunTracker
            phase={state.phase}
            counts={counts}
            elapsedMs={elapsedMs}
            logs={state.logs}
            onRetryAllFailed={retryAllFailed}
            onDownloadAll={handleDownloadAll}
            downloadingAll={downloadingAll}
            downloadProgress={downloadProgress}
          />

          <TaskGrid
            phase={state.phase}
            tasks={state.tasks}
            variantCount={state.variantCount}
            runToken={runToken}
            onExpand={setExpanded}
            onRetry={retryTask}
            onCancelTask={cancelTask}
          />

          <p className="mt-7 text-[13px] italic text-quiet">
            成功卡片悬停即出下载、复制链接、放大与重新生成；中断与重试均可逆，不再二次确认。
          </p>
        </main>
      </div>

      <Lightbox image={expanded} onClose={() => setExpanded(null)} />

      {/* 隐藏后台：无独立路由/子域名，暗号触发后整页覆盖 */}
      <AdminPanel open={adminOpen} onClose={() => setAdminOpen(false)} />

      {/* 未选择用户：强制拦截（上游无 Token 直接 401，无兜底链路） */}
      <AlertDialog open={identityPromptOpen} onOpenChange={setIdentityPromptOpen}>
        <AlertDialogContent className="rounded-sm border-foreground bg-raised sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-sans text-[15px]">
              请选择员工身份
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] leading-relaxed">
              生成前必须选择身份，系统会用该身份的密钥调用工作流；
              未选择时上游直接拒绝请求（401），无法生成。
              没有单独密钥的同事选「其他员工」。选择后将立即以该身份开始生成。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid grid-cols-2 gap-2 py-1">
            {WORKFLOW_USERS.map((user, idx) => (
              <button
                key={user.id}
                type="button"
                onClick={() => handlePickUser(user.id)}
                className={cn(
                  'flex items-center gap-2 rounded-sm border border-rule bg-paper px-3 py-2 text-sm text-foreground transition-colors hover:border-signal hover:bg-teal-wash hover:text-teal-deep',
                  // 奇数个身份时最后一个占满整行，不留半格空位
                  idx === WORKFLOW_USERS.length - 1 &&
                    WORKFLOW_USERS.length % 2 === 1 &&
                    'col-span-2',
                )}
              >
                <UserBadge user={user} />
                {user.name}
              </button>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 rounded-sm text-[13px]">
              稍后再说
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 拆分 AI 不可用：询问是否本地分条 */}
      <AlertDialog
        open={splitFallback !== null}
        onOpenChange={(open) => !open && setSplitFallback(null)}
      >
        <AlertDialogContent className="rounded-sm border-foreground bg-raised sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-sans text-[15px]">
              拆分模型暂不可用
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] leading-relaxed">
              {splitFallback?.reason}
              <br />
              可改用本地规则分条（按编号，其次按空行）继续生成，
              分条准确度低于拆分模型；也可以取消后改用分步模式逐条填写。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 rounded-sm text-[13px]">
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-8 rounded-sm text-[13px]"
              onClick={handleSplitFallbackConfirm}
            >
              本地分条继续
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 批量下载：浏览器多文件下载权限提示 */}
      <AlertDialog open={downloadTipOpen} onOpenChange={setDownloadTipOpen}>
        <AlertDialogContent className="rounded-sm border-foreground bg-raised sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-sans text-[15px]">
              批量下载已开始
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] leading-relaxed">
              浏览器可能拦截多文件下载。如下载无法进行，请检查页面左上角地址栏的站点权限，
              允许「自动下载多个文件」后重试。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction className="h-8 rounded-sm text-[13px]">
              知道了
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
