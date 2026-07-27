'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_CONCURRENCY,
  TASK_MAX_ATTEMPTS,
  TASK_TIMEOUT_MS,
  buildTasks,
  composeSinglePrompt,
  effectiveConcurrency,
  isTaskActive,
  makeRunId,
  outputToTasks,
  type ImageTask,
  type LogEntry,
  type RunPhase,
} from '@/lib/tasks';
import type { UsageStatus } from '@/lib/admin';
import type { WorkflowOutput } from '@/lib/workflow';

/** 客户端流事件：上游事件 + 本服务在 /api/generate 注入的 meta 事件 */
interface StreamEvent {
  type: string;
  run_id?: string;
  node_name?: string;
  output?: unknown;
  message?: string;
  time_cost_ms?: number;
}

/** 单次尝试的结局 */
type Outcome =
  | { kind: 'success'; url: string }
  /** 上游明确返回该条生成失败：确定性问题，不消耗自动重试 */
  | { kind: 'content-failed'; error: string }
  /** 传输/上游异常：可自动重试 */
  | { kind: 'error'; error: string }
  /** 超时：可自动重试 */
  | { kind: 'timeout' }
  /** 用户单点中断或整体取消 */
  | { kind: 'cancelled' };

export interface RunnerState {
  phase: RunPhase;
  tasks: ImageTask[];
  logs: LogEntry[];
  startedAt: number | null;
  endedAt: number | null;
  /** 本批次 ID，用于历史归档 */
  batchId: string | null;
  /** 每条提示词生成的份数 */
  variantCount: number;
  /** 源提示词条数（拆分后的条数） */
  sourceCount: number;
  /** 本次提交的原始文本，用于判断编辑器内容是否与结果对应 */
  submittedText: string;
  /** 全局错误（拆分失败等） */
  error: string | null;
}

const INITIAL_STATE: RunnerState = {
  phase: 'idle',
  tasks: [],
  logs: [],
  startedAt: null,
  endedAt: null,
  batchId: null,
  variantCount: 1,
  sourceCount: 0,
  submittedText: '',
  error: null,
};

function nowLabel(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export interface StartOptions {
  /** 已分条的提示词；统一模式由 /api/split 拆分后传入 */
  prompts: string[];
  userId: string;
  variantCount: number;
  /** 原始提交文本，仅用于归档与「结果是否对应当前输入」判断 */
  submittedText: string;
}

/**
 * 逐张任务调度器。
 *
 * 一条提示词（× 份数）= 一个任务 = 一次独立的上游 run，run_id 由客户端生成，
 * 因此每张都能独立超时、独立重试、独立中断。
 */
export function useTaskRunner() {
  const [state, setState] = useState<RunnerState>(INITIAL_STATE);
  const [concurrency, setConcurrencyState] = useState(DEFAULT_CONCURRENCY);

  /** 任务权威副本：调度决策一律读 ref，避免 setState 异步导致重复占用槽位 */
  const taskMapRef = useRef<Map<string, ImageTask>>(new Map());
  const orderRef = useRef<string[]>([]);
  const controllersRef = useRef<Map<string, AbortController>>(new Map());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  /** 因超时而主动 abort 的任务，用于把 AbortError 区分成「超时」而非「中断」 */
  const timedOutRef = useRef<Set<string>>(new Set());
  const activeRef = useRef(false);
  const concurrencyRef = useRef(DEFAULT_CONCURRENCY);
  const userIdRef = useRef('');
  const logIdRef = useRef(0);
  const splitAbortRef = useRef<AbortController | null>(null);

  const setConcurrency = useCallback((next: number) => {
    concurrencyRef.current = next;
    setConcurrencyState(next);
  }, []);

  const pushLog = useCallback((text: string, tone: LogEntry['tone'] = 'info') => {
    logIdRef.current += 1;
    const entry: LogEntry = { id: logIdRef.current, time: nowLabel(), text, tone };
    setState((prev) => ({ ...prev, logs: [...prev.logs, entry].slice(-200) }));
  }, []);

  const syncTasks = useCallback(() => {
    const list = orderRef.current
      .map((id) => taskMapRef.current.get(id))
      .filter((t): t is ImageTask => Boolean(t));
    setState((prev) => ({ ...prev, tasks: list }));
  }, []);

  const updateTask = useCallback(
    (id: string, patch: Partial<ImageTask>) => {
      const current = taskMapRef.current.get(id);
      if (!current) return;
      taskMapRef.current.set(id, { ...current, ...patch });
      syncTasks();
    },
    [syncTasks],
  );

  /**
   * 用量留痕：单张**终局**时给服务端账本记一笔（隐藏后台的统计数据源）。
   * 只记成功与已耗尽重试的失败——自动重试中的中间态、以及用户中断都不算一张。
   * 失败静默：账本写不进去也绝不能影响生成主链路。
   */
  const recordUsage = useCallback((prompt: string, status: UsageStatus) => {
    const userId = userIdRef.current;
    if (!userId) return;
    void fetch('/api/usage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, prompt, status }),
      keepalive: true,
    }).catch(() => undefined);
  }, []);

  /** 通知上游停止该 run，避免中断/超时后继续烧算力 */
  const cancelUpstream = useCallback(async (runId: string | null) => {
    if (!runId) return;
    try {
      await fetch('/api/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_id: runId,
          user_id: userIdRef.current || undefined,
        }),
      });
    } catch {
      // 取消请求失败不阻塞本地状态收尾
    }
  }, []);

  const clearTaskTimer = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  /** 全部任务落地后收尾 */
  const settle = useCallback(() => {
    const tasks = [...taskMapRef.current.values()];
    if (tasks.some(isTaskActive)) return;
    activeRef.current = false;
    setState((prev) =>
      prev.phase === 'running' || prev.phase === 'splitting'
        ? { ...prev, phase: 'done', endedAt: Date.now() }
        : prev,
    );
  }, []);

  const runTaskRef = useRef<(id: string) => void>(() => {});

  /** 调度：把排队任务填进空闲并发槽位 */
  const pump = useCallback(() => {
    if (!activeRef.current) return;
    const tasks = [...taskMapRef.current.values()];
    const running = tasks.filter((t) => t.status === 'running').length;
    // 填写值可以超过 10，实际开的槽位一律封顶（见 lib/tasks.ts 的 MAX_CONCURRENCY）
    let slots = effectiveConcurrency(concurrencyRef.current) - running;
    if (slots > 0) {
      for (const id of orderRef.current) {
        if (slots <= 0) break;
        const task = taskMapRef.current.get(id);
        if (task?.status !== 'queued') continue;
        slots -= 1;
        runTaskRef.current(id);
      }
    }
    settle();
  }, [settle]);

  /**
   * 读取一次任务运行的 SSE 流，归约成 Outcome。
   * 每收到一个**进展事件**就回调 onProgress 重置超时看门狗；
   * `ping` 心跳刻意不算进展——上游每 30s 必发 ping，若它也重置计时，卡死的运行永不超时。
   */
  const consumeStream = useCallback(
    async (
      resp: Response,
      taskId: string,
      onProgress: () => void,
    ): Promise<Outcome> => {
      if (!resp.ok || !resp.body) {
        const data = (await resp.json().catch(() => null)) as {
          error?: string;
        } | null;
        return {
          kind: 'error',
          error: data?.error ?? `请求失败 (HTTP ${resp.status})`,
        };
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let outcome: Outcome | null = null;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';
        for (const block of blocks) {
          for (const line of block.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            let event: StreamEvent;
            try {
              event = JSON.parse(payload) as StreamEvent;
            } catch {
              continue;
            }
            if (event.type !== 'ping') onProgress();
            if (event.type === 'error') {
              outcome = {
                kind: 'error',
                error: event.message ?? '工作流执行失败',
              };
              continue;
            }
            if (event.type !== 'workflow_end') continue;
            const output = event.output as WorkflowOutput | undefined;
            const images = output?.images ?? [];
            if (images.length === 0) {
              outcome = { kind: 'error', error: '上游未返回图片' };
              continue;
            }
            if (images.length > 1) {
              // 单条提示词被拆分 AI 再拆成了多条：取第一张，其余在日志中提示
              pushLog(
                `任务 ${taskId} 上游返回 ${images.length} 张，已取第 1 张（提示词可能被再次拆分）`,
                'amber',
              );
            }
            const first = images.find((i) => i.status === 'success') ?? images[0];
            outcome =
              first.status === 'success' && first.url
                ? { kind: 'success', url: first.url }
                : { kind: 'content-failed', error: first.error || '生成失败' };
          }
        }
      }

      return outcome ?? { kind: 'error', error: '连接已结束，但未收到完成事件' };
    },
    [pushLog],
  );

  /** 跑一次任务尝试；结束后按结局决定自动重试或落地 */
  const runTask = useCallback(
    (id: string) => {
      const task = taskMapRef.current.get(id);
      if (!task) return;

      const runId = makeRunId();
      const controller = new AbortController();
      controllersRef.current.set(id, controller);
      timedOutRef.current.delete(id);

      const now = Date.now();
      // 同步置为 running，保证同一轮 pump 不会重复占用槽位
      taskMapRef.current.set(id, {
        ...task,
        status: 'running',
        runId,
        attempt: task.attempt + 1,
        startedAt: now,
        lastProgressAt: now,
        endedAt: null,
        error: '',
        failureKind: 'none',
      });
      syncTasks();

      const attemptNo = task.attempt + 1;
      pushLog(
        `#${task.sourceIndex + 1}-${task.variant + 1} 开始生成（第 ${attemptNo}/${task.maxAttempts} 次）· run ${runId.slice(3, 11)}`,
      );

      /**
       * 单张超时看门狗：距上一个进展事件超过 TASK_TIMEOUT_MS 即判卡死，
       * abort 本地流并通知上游取消。每来一个进展事件就重新计时。
       */
      const armWatchdog = () => {
        clearTaskTimer(id);
        timersRef.current.set(
          id,
          setTimeout(() => {
            timedOutRef.current.add(id);
            controller.abort();
            void cancelUpstream(runId);
          }, TASK_TIMEOUT_MS),
        );
      };
      armWatchdog();

      const onProgress = () => {
        armWatchdog();
        updateTask(id, { lastProgressAt: Date.now() });
      };

      void (async () => {
        const startedAt = Date.now();
        let outcome: Outcome;
        try {
          const resp = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompts_text: composeSinglePrompt(task.prompt),
              run_id: runId,
              user_id: userIdRef.current || undefined,
            }),
            signal: controller.signal,
          });
          outcome = await consumeStream(
            resp,
            `#${task.sourceIndex + 1}-${task.variant + 1}`,
            onProgress,
          );
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') {
            outcome = timedOutRef.current.has(id)
              ? { kind: 'timeout' }
              : { kind: 'cancelled' };
          } else {
            outcome = {
              kind: 'error',
              error: err instanceof Error ? err.message : '未知错误',
            };
          }
        } finally {
          clearTaskTimer(id);
          controllersRef.current.delete(id);
          timedOutRef.current.delete(id);
        }

        const latest = taskMapRef.current.get(id);
        if (!latest) return;
        const elapsedMs = latest.elapsedMs + (Date.now() - startedAt);
        const label = `#${latest.sourceIndex + 1}-${latest.variant + 1}`;
        const secs = ((Date.now() - startedAt) / 1000).toFixed(1);

        if (outcome.kind === 'success') {
          updateTask(id, {
            status: 'succeeded',
            url: outcome.url,
            error: '',
            failureKind: 'none',
            endedAt: Date.now(),
            elapsedMs,
          });
          pushLog(`${label} 生成成功 · ${secs}s`, 'ok');
          recordUsage(latest.prompt, 'success');
          pump();
          return;
        }

        if (outcome.kind === 'cancelled') {
          updateTask(id, {
            status: 'cancelled',
            error: '已中断',
            failureKind: 'cancelled',
            endedAt: Date.now(),
            elapsedMs,
          });
          pushLog(`${label} 已中断`, 'err');
          pump();
          return;
        }

        const canAutoRetry =
          (outcome.kind === 'timeout' || outcome.kind === 'error') &&
          latest.attempt < latest.maxAttempts;

        const message =
          outcome.kind === 'timeout'
            ? `${Math.round(TASK_TIMEOUT_MS / 1000)}s 无进展，判定卡死`
            : outcome.error;

        if (canAutoRetry) {
          updateTask(id, {
            status: 'queued',
            error: message,
            failureKind: outcome.kind === 'timeout' ? 'timeout' : 'error',
            endedAt: null,
            elapsedMs,
          });
          pushLog(
            `${label} ${message} · 自动重试（${latest.attempt}/${latest.maxAttempts} 次已用）`,
            'amber',
          );
        } else {
          updateTask(id, {
            status: 'failed',
            error:
              outcome.kind === 'timeout'
                ? `${message}，已重试 ${latest.attempt - 1} 次`
                : message,
            failureKind: outcome.kind === 'timeout' ? 'timeout' : 'error',
            endedAt: Date.now(),
            elapsedMs,
          });
          pushLog(`${label} 失败 · ${message}`, 'err');
          recordUsage(latest.prompt, 'failed');
        }
        pump();
      })();
    },
    [
      cancelUpstream,
      clearTaskTimer,
      consumeStream,
      pump,
      pushLog,
      recordUsage,
      syncTasks,
      updateTask,
    ],
  );

  // pump 通过 ref 间接调用 runTask，打断两者的循环依赖
  useEffect(() => {
    runTaskRef.current = runTask;
  }, [runTask]);

  /** 用已分条的提示词启动一批任务 */
  const start = useCallback(
    ({ prompts, userId, variantCount, submittedText }: StartOptions) => {
      // 收掉上一批的残留
      for (const controller of controllersRef.current.values()) controller.abort();
      controllersRef.current.clear();
      for (const timer of timersRef.current.values()) clearTimeout(timer);
      timersRef.current.clear();
      timedOutRef.current.clear();

      const tasks = buildTasks(prompts, variantCount, TASK_MAX_ATTEMPTS);
      taskMapRef.current = new Map(tasks.map((t) => [t.id, t]));
      orderRef.current = tasks.map((t) => t.id);
      userIdRef.current = userId;
      activeRef.current = true;
      logIdRef.current = 0;

      const batchId = makeRunId();
      setState({
        ...INITIAL_STATE,
        phase: 'running',
        tasks,
        startedAt: Date.now(),
        batchId,
        variantCount,
        sourceCount: prompts.length,
        submittedText,
        logs: [
          {
            id: 0,
            time: nowLabel(),
            text: `批次启动 · ${prompts.length} 条提示词 × ${variantCount} 份 = ${tasks.length} 个任务 · 并发 ${effectiveConcurrency(concurrencyRef.current)}${
              concurrencyRef.current > effectiveConcurrency(concurrencyRef.current)
                ? `（填写 ${concurrencyRef.current}，按上限执行）`
                : ''
            } · 单张无进展超时 ${Math.round(TASK_TIMEOUT_MS / 1000)}s`,
            tone: 'amber',
          },
        ],
      });
      pump();
    },
    [pump],
  );

  /** 统一模式：先借上游拆分 AI 分条，再逐张跑 */
  const startWithSplit = useCallback(
    async (
      promptsText: string,
      userId: string,
      variantCount: number,
    ): Promise<{ ok: boolean; error?: string }> => {
      splitAbortRef.current?.abort();
      const controller = new AbortController();
      splitAbortRef.current = controller;

      logIdRef.current = 0;
      setState({
        ...INITIAL_STATE,
        phase: 'splitting',
        startedAt: Date.now(),
        variantCount,
        submittedText: promptsText,
        logs: [
          {
            id: 0,
            time: nowLabel(),
            text: '调用上游拆分 AI 分条…',
            tone: 'amber',
          },
        ],
      });

      try {
        const resp = await fetch('/api/split', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompts_text: promptsText, user_id: userId }),
          signal: controller.signal,
        });
        const data = (await resp.json()) as {
          prompts?: string[];
          error?: string;
        };
        if (!resp.ok || !data.prompts?.length) {
          const error = data.error ?? '拆分失败';
          setState((prev) => ({
            ...prev,
            phase: 'idle',
            error,
            endedAt: Date.now(),
          }));
          return { ok: false, error };
        }
        pushLog(`拆分完成 · 识别出 ${data.prompts.length} 条提示词`, 'ok');
        start({
          prompts: data.prompts,
          userId,
          variantCount,
          submittedText: promptsText,
        });
        return { ok: true };
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return { ok: false, error: '已取消' };
        }
        const error = err instanceof Error ? err.message : '拆分请求失败';
        setState((prev) => ({ ...prev, phase: 'idle', error, endedAt: Date.now() }));
        return { ok: false, error };
      }
    },
    [pushLog, start],
  );

  /** 单点中断：只掐这一张，其余任务继续 */
  const cancelTask = useCallback(
    (id: string) => {
      const task = taskMapRef.current.get(id);
      if (!task || !isTaskActive(task)) return;
      if (task.status === 'queued') {
        updateTask(id, {
          status: 'cancelled',
          error: '已中断（排队中）',
          failureKind: 'cancelled',
          endedAt: Date.now(),
        });
        pushLog(`#${task.sourceIndex + 1}-${task.variant + 1} 已从队列移除`, 'err');
        pump();
        return;
      }
      clearTaskTimer(id);
      controllersRef.current.get(id)?.abort();
      void cancelUpstream(task.runId);
      // 状态由 runTask 的 AbortError 分支落定为 cancelled
    },
    [cancelUpstream, clearTaskTimer, pump, pushLog, updateTask],
  );

  /** 单张手动重试：重置尝试次数后插队重跑 */
  const retryTask = useCallback(
    (id: string) => {
      const task = taskMapRef.current.get(id);
      if (!task || isTaskActive(task)) return;
      activeRef.current = true;
      taskMapRef.current.set(id, {
        ...task,
        status: 'queued',
        attempt: 0,
        error: '',
        failureKind: 'none',
        url: '',
        runId: null,
        startedAt: null,
        endedAt: null,
      });
      syncTasks();
      setState((prev) => ({
        ...prev,
        phase: 'running',
        startedAt:
          prev.phase === 'done' || prev.phase === 'cancelled'
            ? Date.now()
            : prev.startedAt,
        endedAt: null,
      }));
      pushLog(`#${task.sourceIndex + 1}-${task.variant + 1} 手动重试`, 'amber');
      pump();
    },
    [pump, pushLog, syncTasks],
  );

  /** 重试全部失败/中断的任务 */
  const retryAllFailed = useCallback(() => {
    const targets = [...taskMapRef.current.values()].filter(
      (t) => t.status === 'failed' || t.status === 'cancelled',
    );
    if (targets.length === 0) return;
    activeRef.current = true;
    for (const task of targets) {
      taskMapRef.current.set(task.id, {
        ...task,
        status: 'queued',
        attempt: 0,
        error: '',
        failureKind: 'none',
        url: '',
        runId: null,
        startedAt: null,
        endedAt: null,
      });
    }
    syncTasks();
    setState((prev) => ({
      ...prev,
      phase: 'running',
      startedAt:
        prev.phase === 'done' || prev.phase === 'cancelled'
          ? Date.now()
          : prev.startedAt,
      endedAt: null,
    }));
    pushLog(`重试全部失败 · ${targets.length} 张`, 'amber');
    pump();
  }, [pump, pushLog, syncTasks]);

  /** 整体取消：停止排队、中断在跑的任务 */
  const cancelAll = useCallback(() => {
    activeRef.current = false;
    splitAbortRef.current?.abort();
    for (const [id, timer] of timersRef.current) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    for (const task of taskMapRef.current.values()) {
      if (task.status === 'running') {
        controllersRef.current.get(task.id)?.abort();
        void cancelUpstream(task.runId);
        taskMapRef.current.set(task.id, {
          ...task,
          status: 'cancelled',
          error: '已中断',
          failureKind: 'cancelled',
          endedAt: Date.now(),
        });
      } else if (task.status === 'queued') {
        taskMapRef.current.set(task.id, {
          ...task,
          status: 'cancelled',
          error: '已中断（排队中）',
          failureKind: 'cancelled',
          endedAt: Date.now(),
        });
      }
    }
    controllersRef.current.clear();
    syncTasks();
    setState((prev) => ({ ...prev, phase: 'cancelled', endedAt: Date.now() }));
    pushLog('批次已取消', 'err');
  }, [cancelUpstream, pushLog, syncTasks]);

  /** 历史回放：载入历史结果，仍可对单张重新生成 */
  const loadOutput = useCallback(
    (output: WorkflowOutput, promptsText: string) => {
      activeRef.current = false;
      for (const controller of controllersRef.current.values()) controller.abort();
      controllersRef.current.clear();
      for (const timer of timersRef.current.values()) clearTimeout(timer);
      timersRef.current.clear();

      const tasks = outputToTasks(output, TASK_MAX_ATTEMPTS);
      taskMapRef.current = new Map(tasks.map((t) => [t.id, t]));
      orderRef.current = tasks.map((t) => t.id);
      logIdRef.current = 0;

      setState({
        ...INITIAL_STATE,
        phase: 'done',
        tasks,
        batchId: output.run_id || null,
        variantCount: 1,
        sourceCount: tasks.length,
        submittedText: promptsText,
        logs: [
          {
            id: 0,
            time: nowLabel(),
            text: `已载入历史运行 ${output.run_id ? `${output.run_id.slice(0, 8)}…` : '(无 run_id)'} · ${tasks.length} 张`,
            tone: 'info',
          },
        ],
      });
    },
    [],
  );

  const reset = useCallback(() => {
    activeRef.current = false;
    for (const controller of controllersRef.current.values()) controller.abort();
    controllersRef.current.clear();
    for (const timer of timersRef.current.values()) clearTimeout(timer);
    timersRef.current.clear();
    taskMapRef.current = new Map();
    orderRef.current = [];
    setState(INITIAL_STATE);
  }, []);

  useEffect(() => {
    const controllers = controllersRef.current;
    const timers = timersRef.current;
    return () => {
      for (const controller of controllers.values()) controller.abort();
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);

  return {
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
    reset,
  };
}
