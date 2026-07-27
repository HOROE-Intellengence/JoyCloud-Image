import { NextRequest } from 'next/server';
import { buildUpstreamHeaders, resolveUpstream } from '@/lib/workflow';
import { isValidUserId } from '@/lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/cancel
 * 代理上游 /cancel/{run_id}，取消正在执行的工作流运行。
 * body: { run_id: string; user_id?: string }
 */
export async function POST(request: NextRequest) {
  let runId = '';
  let userId = '';
  try {
    const body = (await request.json()) as {
      run_id?: string;
      user_id?: string;
    };
    runId = (body.run_id ?? '').trim();
    userId = (body.user_id ?? '').trim();
  } catch {
    return Response.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  if (!runId) {
    return Response.json({ error: 'run_id 不能为空' }, { status: 400 });
  }
  if (userId && !isValidUserId(userId)) {
    return Response.json({ error: '未知的用户标识' }, { status: 400 });
  }

  const upstream = resolveUpstream(userId || null);

  try {
    const upstreamResp = await fetch(
      `${upstream.baseUrl}/cancel/${encodeURIComponent(runId)}`,
      {
        method: 'POST',
        headers: buildUpstreamHeaders(upstream.token),
      },
    );
    const text = await upstreamResp.text().catch(() => '');
    if (!upstreamResp.ok) {
      return Response.json(
        { error: `取消失败 (HTTP ${upstreamResp.status})`, detail: text },
        { status: 502 },
      );
    }
    return Response.json({ ok: true, run_id: runId, detail: text });
  } catch {
    return Response.json({ error: '无法连接上游工作流服务' }, { status: 502 });
  }
}
