import { NextRequest } from 'next/server';
import { buildUpstreamHeaders, resolveUpstream } from '@/lib/workflow';
import { isValidUserId } from '@/lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/generate
 * 代理上游工作流 /stream_run（SSE 流式运行，debug 模式推送节点级事件），
 * 将上游 SSE 字节流原样转发给前端，由前端解析事件并增量渲染。
 *
 * body: { prompts_text: string; run_id?: string; user_id?: string }
 * user_id 有效时自动选取对应用户的 Bearer Token 调用生产域名。
 */
export async function POST(request: NextRequest) {
  let promptsText = '';
  let clientRunId = '';
  let userId = '';

  try {
    const body = (await request.json()) as {
      prompts_text?: string;
      run_id?: string;
      user_id?: string;
    };
    promptsText = (body.prompts_text ?? '').trim();
    clientRunId = (body.run_id ?? '').trim();
    userId = (body.user_id ?? '').trim();
  } catch {
    return Response.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  if (!promptsText) {
    return Response.json({ error: 'prompts_text 不能为空' }, { status: 400 });
  }
  // 用户是必填项：上游生产域名对无 Bearer Token 的请求直接 401，没有可用的兜底链路
  if (!isValidUserId(userId)) {
    return Response.json({ error: '请先选择用户' }, { status: 400 });
  }

  const upstream = resolveUpstream(userId);
  const runId =
    clientRunId ||
    (globalThis.crypto?.randomUUID?.() ??
      `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

  let upstreamResp: Response;
  try {
    upstreamResp = await fetch(`${upstream.baseUrl}/stream_run`, {
      method: 'POST',
      headers: buildUpstreamHeaders(upstream.token, {
        'x-workflow-stream-mode': 'debug',
        'x-run-id': runId,
      }),
      body: JSON.stringify({ prompts_text: promptsText }),
      signal: request.signal,
    });
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? '客户端已中断请求'
        : '无法连接上游工作流服务';
    return Response.json({ error: message }, { status: 502 });
  }

  if (!upstreamResp.ok || !upstreamResp.body) {
    const detail = await upstreamResp.text().catch(() => '');
    return Response.json(
      { error: `上游工作流响应异常 (HTTP ${upstreamResp.status})`, detail },
      { status: upstreamResp.status === 401 ? 401 : 502 },
    );
  }

  // 原样透传上游 SSE 流；在流开头注入一条 meta 事件告知前端本次 run_id
  const encoder = new TextEncoder();
  const upstreamBody = upstreamResp.body;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: 'meta', run_id: runId, user_id: userId || null })}\n\n`,
        ),
      );
      const reader = upstreamBody.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } catch {
        // 客户端断开或上游中断，静默收尾
      } finally {
        try {
          controller.close();
        } catch {
          // 流可能已关闭
        }
      }
    },
    cancel() {
      upstreamBody.cancel().catch(() => undefined);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
