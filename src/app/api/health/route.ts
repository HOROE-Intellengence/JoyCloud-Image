import { NextRequest } from 'next/server';
import { buildUpstreamHeaders, resolveUpstream } from '@/lib/workflow';
import { isValidUserId } from '@/lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/health?user_id=xxx
 * 聚合健康检查：本服务存活 + 上游工作流服务可达性。
 * 携带 user_id 时探测该用户对应的生产链路（含 Token 鉴权有效性）。
 */
export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id') ?? '';

  if (userId && !isValidUserId(userId)) {
    return Response.json({ error: '未知的用户标识' }, { status: 400 });
  }
  // 未指定用户时不探上游：无 Token 请求必然 401，探活结果无参考价值
  if (!userId) {
    return Response.json({ status: 'unselected', message: '未选择用户' });
  }

  const upstream = resolveUpstream(userId);

  try {
    const upstreamResp = await fetch(`${upstream.baseUrl}/health`, {
      headers: buildUpstreamHeaders(upstream.token),
      cache: 'no-store',
    });
    const data = (await upstreamResp.json().catch(() => null)) as {
      status?: string;
      message?: string;
    } | null;
    return Response.json({
      status: upstreamResp.ok && data?.status === 'ok' ? 'ok' : 'degraded',
      upstream_status: upstreamResp.status,
      upstream: data,
    });
  } catch {
    return Response.json(
      { status: 'down', error: '无法连接上游工作流服务' },
      { status: 502 },
    );
  }
}
