/**
 * 批量图片生成工作流上游配置与类型定义
 * 文档参考：批量图片生成工作流 API 参考手册
 */
import { getTokenForUser } from './user-tokens';

// 默认回落至生产域名（dev 沙箱为临时地址，易被销毁）；可通过环境变量覆盖
export const WORKFLOW_BASE_URL =
  process.env.WORKFLOW_BASE_URL ?? 'https://yunyue-image2.coze.site';

export const WORKFLOW_PROD_BASE_URL =
  process.env.WORKFLOW_PROD_BASE_URL ?? 'https://yunyue-image2.coze.site';

export const WORKFLOW_TOKEN = process.env.WORKFLOW_TOKEN ?? '';

export interface ImageResult {
  index: number;
  prompt: string;
  url: string;
  status: 'success' | 'failed';
  error: string;
}

export interface WorkflowOutput {
  images: ImageResult[];
  total_count: number;
  success_count: number;
  run_id: string;
}

export type WorkflowEventType =
  | 'workflow_start'
  | 'node_start'
  | 'node_end'
  | 'workflow_end'
  | 'error'
  | 'ping';

export interface WorkflowEvent {
  type: WorkflowEventType;
  run_id?: string;
  node_name?: string;
  input?: unknown;
  output?: WorkflowOutput | unknown;
  time_cost_ms?: number;
  code?: string;
  message?: string;
}

export interface UpstreamTarget {
  baseUrl: string;
  token: string;
}

/**
 * 解析上游目标：传入有效 user_id 时走生产域名 + 该用户的 Bearer Token；
 * 否则回落到默认 dev 预览域名（免鉴权）。
 */
export function resolveUpstream(userId?: string | null): UpstreamTarget {
  if (userId) {
    const token = getTokenForUser(userId);
    if (token) {
      return { baseUrl: WORKFLOW_PROD_BASE_URL, token };
    }
  }
  return { baseUrl: WORKFLOW_BASE_URL, token: WORKFLOW_TOKEN };
}

/**
 * 从 `split_prompts` 节点输出中防御式提取提示词文本列表。
 * 实测形态为 `{ prompts: ["…", "…"] }`，此处同时兼容裸数组、
 * 常见包裹键与字符串化 JSON。提取不到返回 null。
 */
export function extractPromptList(
  output: unknown,
  depth = 0,
): string[] | null {
  if (output == null || depth > 3) return null;
  if (typeof output === 'string') {
    const s = output.trim();
    if (!s.startsWith('[') && !s.startsWith('{')) return null;
    try {
      return extractPromptList(JSON.parse(s), depth + 1);
    } catch {
      return null;
    }
  }
  if (Array.isArray(output)) {
    const items = output
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object') {
          const prompt = (item as Record<string, unknown>).prompt;
          return typeof prompt === 'string' ? prompt.trim() : '';
        }
        return '';
      })
      .filter((s) => s.length > 0);
    return items.length > 0 ? items : null;
  }
  if (typeof output === 'object') {
    const record = output as Record<string, unknown>;
    for (const key of ['prompts', 'prompt_list', 'list', 'items', 'output', 'data', 'result']) {
      if (key in record) {
        const list = extractPromptList(record[key], depth + 1);
        if (list) return list;
      }
    }
  }
  return null;
}

/**
 * 从 `distribute_tasks` 节点输出（`{ group1_tasks: [{index, prompt}], … }`）
 * 还原按原始顺序排列的提示词列表，作为拆分节点解析失败时的兜底。
 */
export function extractDistributedPrompts(output: unknown): string[] | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null;
  const record = output as Record<string, unknown>;
  const collected: { index: number; prompt: string }[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (!/_tasks$/.test(key) || !Array.isArray(value)) continue;
    value.forEach((item, i) => {
      if (!item || typeof item !== 'object') return;
      const entry = item as Record<string, unknown>;
      const prompt = typeof entry.prompt === 'string' ? entry.prompt.trim() : '';
      if (!prompt) return;
      const index = typeof entry.index === 'number' ? entry.index : i;
      collected.push({ index, prompt });
    });
  }
  if (collected.length === 0) return null;
  return collected.sort((a, b) => a.index - b.index).map((c) => c.prompt);
}

/** 构造请求上游工作流的请求头（有 Token 时自动附带 Bearer） */
export function buildUpstreamHeaders(
  token: string,
  extra?: Record<string, string>,
): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extra,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}
