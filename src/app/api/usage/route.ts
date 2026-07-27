import { NextRequest } from 'next/server';
import { isAdminCode } from '@/lib/admin';
import { isValidUserId } from '@/lib/users';
import { aggregateUsage, appendUsage, readUsage } from '@/lib/usage-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/usage —— 落一条用量流水。
 *
 * 由前端在**单张任务终局**（成功 / 已耗尽重试的失败）时上报：状态只有前端解析完
 * SSE 才知道，而 /api/generate 是字节透传的代理，服务端不解析流。
 * 排队中断（cancelled）不上报——没出图、也不该计费。
 *
 * body: { user_id: string; prompt: string; status: 'success' | 'failed' }
 */
export async function POST(request: NextRequest) {
  let userId = '';
  let prompt = '';
  let status = '';

  try {
    const body = (await request.json()) as {
      user_id?: string;
      prompt?: string;
      status?: string;
    };
    userId = (body.user_id ?? '').trim();
    prompt = (body.prompt ?? '').trim();
    status = (body.status ?? '').trim();
  } catch {
    return Response.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  if (!isValidUserId(userId)) {
    return Response.json({ error: '非法 user_id' }, { status: 400 });
  }
  if (status !== 'success' && status !== 'failed') {
    return Response.json({ error: 'status 只能是 success/failed' }, { status: 400 });
  }

  await appendUsage({ userId, prompt, status });
  return Response.json({ ok: true });
}

/**
 * GET /api/usage?code=<暗号> —— 返回聚合统计，供隐藏后台渲染。
 *
 * 暗号与前台入口是同一个（见 lib/admin.ts）：它挡的是「随手访问」，
 * 不是权限体系；账本里没有 Token 之类的敏感物。
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code') ?? '';
  if (!isAdminCode(code)) {
    return Response.json({ error: '无效的访问码' }, { status: 403 });
  }

  try {
    const records = await readUsage();
    return Response.json(aggregateUsage(records));
  } catch (err) {
    console.error('[usage] 读取失败', err);
    return Response.json({ error: '读取用量账本失败' }, { status: 500 });
  }
}
