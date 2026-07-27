/**
 * 逐张任务模型。
 *
 * 设计前提（实测结论，见 structure.md P5）：上游工作流一次 /stream_run 只在
 * 组级 node_end 才吐结果，无法对「单张」做超时判定、单独重试或单独中断。
 * 因此改为一条提示词 = 一次独立 run（客户端自带 x-run-id），
 * 由前端调度器控制并发、超时、重试与中断。
 */
import type { ImageResult, WorkflowOutput } from './workflow';

export type RunPhase =
  | 'idle'
  /** 拆分探针进行中（统一模式借上游拆分 AI 分条） */
  | 'splitting'
  | 'running'
  | 'done'
  | 'cancelled';

export type TaskStatus =
  /** 排队中，等待并发槽位 */
  | 'queued'
  /** 正在跑（已建立 run_id） */
  | 'running'
  | 'succeeded'
  /** 失败且已用尽自动重试 */
  | 'failed'
  /** 被用户单点中断 */
  | 'cancelled';

/** 单张任务上一次结束的原因，决定卡片文案与是否自动重试 */
export type TaskFailureKind = 'none' | 'timeout' | 'error' | 'cancelled';

export interface ImageTask {
  /** 稳定唯一键：`${sourceIndex}-${variant}` */
  id: string;
  /** 第几条提示词（0 基），对应输入顺序 */
  sourceIndex: number;
  /** 第几份（0 基）；一生三时为 0/1/2 */
  variant: number;
  prompt: string;
  status: TaskStatus;
  /** 当前/最近一次尝试的上游 run_id，单点中断与取消都依赖它 */
  runId: string | null;
  url: string;
  error: string;
  failureKind: TaskFailureKind;
  /** 已发起的尝试次数（含首次） */
  attempt: number;
  /** 最大尝试次数（含首次）；超时/网络错误才消耗自动重试 */
  maxAttempts: number;
  /** 本次尝试开始时间，用于耗时统计 */
  startedAt: number | null;
  /**
   * 最近一次收到上游**进展事件**的时间（`ping` 心跳不算）。
   * 超时看门狗以此为基准：210s 没有任何进展才判定卡死。
   */
  lastProgressAt: number | null;
  endedAt: number | null;
  /** 累计耗时（毫秒），跨多次尝试累加 */
  elapsedMs: number;
}

export interface LogEntry {
  id: number;
  time: string;
  text: string;
  tone: 'info' | 'ok' | 'err' | 'amber';
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * 单张生成超时阈值：默认 210_000ms（210s）。
 *
 * **口径是「无进展」而不是「总耗时」**，即距离上一个上游进展事件
 * （workflow_start / node_start / node_end / workflow_end）超过 210s 才判超时；
 * `ping` 心跳不重置计时——上游每 30s 必发一个 ping，若它也算进展，卡死的运行将永远不超时。
 *
 * 为什么不用总耗时：实测上游单张耗时方差极大——并发 1 时连续两张各 37.0s／37.1s，
 * 并发 3 时同一提示词的三张为 81.7s／175.8s／199.6s。若按总耗时判 210s，
 * 并发稍高就会把健康但排在后面的运行误杀重启，制造重试风暴。
 * 按「无进展」判定则只惩罚真正卡住的运行。
 *
 * 上游确实会整条卡死：实测并发 1 下的第三张 210s 内未收到任何进展事件，
 * 由本看门狗判定卡死并自动重试——这正是本机制存在的意义。
 *
 * 本地验收超时链路时可用 NEXT_PUBLIC_TASK_TIMEOUT_MS 调小，走的是同一条代码路径。
 */
export const TASK_TIMEOUT_MS = readPositiveInt(
  process.env.NEXT_PUBLIC_TASK_TIMEOUT_MS,
  210_000,
);

/** 单张最大尝试次数（含首次）。默认 3 = 首次 + 2 次自动重试 */
export const TASK_MAX_ATTEMPTS = readPositiveInt(
  process.env.NEXT_PUBLIC_TASK_MAX_ATTEMPTS,
  3,
);

/**
 * 默认并发槽位。取 3 而非 5：实测并发升高时单张墙钟时间明显变长
 * （并发 3 时出现 199.6s，已逼近 210s 阈值），吞吐收益却不明显。
 * UI 上可 1–10 调节；批量很大且不赶时间时，调低反而更稳。
 */
export const DEFAULT_CONCURRENCY = Math.min(
  readPositiveInt(process.env.NEXT_PUBLIC_TASK_CONCURRENCY, 3),
  10,
);

export const MIN_CONCURRENCY = 1;
export const MAX_CONCURRENCY = 10;

/** 一生三：每条提示词生成的份数选项 */
export const VARIANT_CHOICES = [1, 3] as const;
export type VariantCount = (typeof VARIANT_CHOICES)[number];

export function isVariantCount(n: number): n is VariantCount {
  return (VARIANT_CHOICES as readonly number[]).includes(n);
}

/** 生成客户端侧 run_id：上游接受 x-run-id，提前持有才能做单点中断 */
export function makeRunId(): string {
  const rand =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `jc-${rand}`;
}

/**
 * 单张任务提交给上游的文本。
 * 合并内部换行并加 `1.` 编号，把长提示词钉成「一条」，
 * 避免拆分 AI 把一条长文本再拆成多条（那会让一个任务返回多张图）。
 */
export function composeSinglePrompt(prompt: string): string {
  return `1. ${prompt.replace(/\s*\n\s*/g, ' ').trim()}`;
}

/** 按份数展开提示词列表为任务列表 */
export function buildTasks(
  prompts: string[],
  variantCount: number,
  maxAttempts: number = TASK_MAX_ATTEMPTS,
): ImageTask[] {
  const tasks: ImageTask[] = [];
  prompts.forEach((prompt, sourceIndex) => {
    for (let variant = 0; variant < variantCount; variant += 1) {
      tasks.push({
        id: `${sourceIndex}-${variant}`,
        sourceIndex,
        variant,
        prompt,
        status: 'queued',
        runId: null,
        url: '',
        error: '',
        failureKind: 'none',
        attempt: 0,
        maxAttempts,
        startedAt: null,
        lastProgressAt: null,
        endedAt: null,
        elapsedMs: 0,
      });
    }
  });
  return tasks;
}

/** 卡片编号：单份为 `#01`，多份为 `#01-2` */
export function taskLabel(task: ImageTask, variantCount: number): string {
  const base = `#${String(task.sourceIndex + 1).padStart(2, '0')}`;
  return variantCount > 1 ? `${base}-${task.variant + 1}` : base;
}

/** 灯箱预览用的最小图片信息 */
export interface PreviewImage {
  url: string;
  prompt: string;
  label: string;
  fileName: string;
}

/** 任务列表 → 与历史记录兼容的 WorkflowOutput（index 取展示顺序） */
export function tasksToOutput(
  tasks: ImageTask[],
  runId: string,
): WorkflowOutput {
  const images: ImageResult[] = tasks.map((task, i) => ({
    index: i,
    prompt: task.prompt,
    url: task.url,
    status: task.status === 'succeeded' ? 'success' : 'failed',
    error: task.status === 'succeeded' ? '' : task.error,
  }));
  return {
    images,
    total_count: images.length,
    success_count: images.filter((i) => i.status === 'success').length,
    run_id: runId,
  };
}

/** WorkflowOutput（历史回放）→ 任务列表，回放后仍可单张重试 */
export function outputToTasks(
  output: WorkflowOutput,
  maxAttempts: number = TASK_MAX_ATTEMPTS,
): ImageTask[] {
  return output.images.map((image, i) => ({
    id: `${i}-0`,
    sourceIndex: i,
    variant: 0,
    prompt: image.prompt,
    status: image.status === 'success' ? 'succeeded' : 'failed',
    runId: null,
    url: image.url,
    error: image.error,
    failureKind: image.status === 'success' ? 'none' : 'error',
    attempt: 1,
    maxAttempts,
    startedAt: null,
    lastProgressAt: null,
    endedAt: null,
    elapsedMs: 0,
  }));
}

export function isTaskActive(task: ImageTask): boolean {
  return task.status === 'queued' || task.status === 'running';
}
