import { NextRequest } from 'next/server';
import {
  buildUpstreamHeaders,
  extractDistributedPrompts,
  extractPromptList,
  resolveUpstream,
} from '@/lib/workflow';
import { isValidUserId } from '@/lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 拆分探针最长等待时间：实测拆分节点约 2–3s，30s 已是极宽松上限 */
const SPLIT_PROBE_TIMEOUT_MS = 30_000;

interface StreamEvent {
  type?: string;
  node_name?: string;
  output?: unknown;
  message?: string;
}

/**
 * POST /api/split
 * 「拆分探针」：只借用上游的拆分 AI，不产图。
 *
 * 实现方式：正常发起一次 /stream_run，读到 `split_prompts` 的 node_end 就拿到
 * 提示词数组，随即立刻 POST /cancel 掐断该运行（实测拆分在 ~3s 完成，生图需 ~52s，
 * 此时生图尚未产出，中断可避免真实算力消耗），把提示词列表返回前端，
 * 交给逐张任务引擎逐条独立运行——这是「单张超时/重试/中断/一生三」的前提。
 *
 * body: { prompts_text: string; user_id: string }
 * 200:  { prompts: string[]; run_id: string; source: 'split_prompts' | 'distribute_tasks' }
 */
export async function POST(request: NextRequest) {
  let promptsText = '';
  let userId = '';

  try {
    const body = (await request.json()) as {
      prompts_text?: string;
      user_id?: string;
    };
    promptsText = (body.prompts_text ?? '').trim();
    userId = (body.user_id ?? '').trim();
  } catch {
    return Response.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  if (!promptsText) {
    return Response.json({ error: 'prompts_text 不能为空' }, { status: 400 });
  }
  if (!isValidUserId(userId)) {
    return Response.json({ error: '请先选择用户' }, { status: 400 });
  }

  const upstream = resolveUpstream(userId);
  const runId = `split-${globalThis.crypto.randomUUID()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SPLIT_PROBE_TIMEOUT_MS);

  /** 掐断探针运行，避免上游继续生图 */
  const cancelProbe = async () => {
    try {
      await fetch(`${upstream.baseUrl}/cancel/${encodeURIComponent(runId)}`, {
        method: 'POST',
        headers: buildUpstreamHeaders(upstream.token),
      });
    } catch {
      // 取消失败不影响返回结果，仅可能多消耗一次上游运行
    }
  };

  try {
    const upstreamResp = await fetch(`${upstream.baseUrl}/stream_run`, {
      method: 'POST',
      headers: buildUpstreamHeaders(upstream.token, {
        'x-workflow-stream-mode': 'debug',
        'x-run-id': runId,
      }),
      body: JSON.stringify({ prompts_text: promptsText }),
      signal: controller.signal,
    });

    if (!upstreamResp.ok || !upstreamResp.body) {
      const detail = await upstreamResp.text().catch(() => '');
      clearTimeout(timer);
      return Response.json(
        { error: `拆分服务响应异常 (HTTP ${upstreamResp.status})`, detail },
        { status: upstreamResp.status === 401 ? 401 : 502 },
      );
    }

    const reader = upstreamResp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let prompts: string[] | null = null;
    let source: 'split_prompts' | 'distribute_tasks' = 'split_prompts';
    let upstreamError = '';

    outer: for (;;) {
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
          if (event.type === 'error') {
            upstreamError = event.message ?? '拆分过程上游报错';
            break outer;
          }
          if (event.type !== 'node_end') continue;
          if (event.node_name === 'split_prompts') {
            prompts = extractPromptList(event.output);
            if (prompts) break outer;
          }
          // 拆分节点输出解析不出时，用分组节点还原顺序
          if (event.node_name === 'distribute_tasks') {
            prompts = extractDistributedPrompts(event.output);
            if (prompts) {
              source = 'distribute_tasks';
              break outer;
            }
          }
        }
      }
    }

    clearTimeout(timer);
    // 无论成功与否都掐断探针运行，避免上游继续把整批图生完
    void reader.cancel().catch(() => undefined);
    await cancelProbe();

    if (!prompts || prompts.length === 0) {
      return Response.json(
        { error: upstreamError || '未能从上游拆分节点解析出提示词' },
        { status: 502 },
      );
    }

    return Response.json({ prompts, run_id: runId, source });
  } catch (err) {
    clearTimeout(timer);
    await cancelProbe();
    const aborted = err instanceof Error && err.name === 'AbortError';
    return Response.json(
      { error: aborted ? '拆分超时，请重试或改用分步模式' : '无法连接上游工作流服务' },
      { status: 502 },
    );
  }
}
