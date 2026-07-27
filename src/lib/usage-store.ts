/**
 * 【仅服务端】用量留痕的最小存储：一行一条 JSON 的追加文件（JSONL）。
 *
 * 为什么不上数据库：本工作台是内部工具，量级是「每天几十到几百张」，
 * 需求只有「按身份/按日期汇总 + 看提示词」。JSONL 的好处是——
 * 写入是 O(1) 追加、天然抗并发（单条 write 小于 PIPE_BUF 不会交错）、
 * 坏行不影响其它行、用 `tail`/编辑器就能查，且不引入任何依赖与迁移成本。
 * 需要清账时直接删文件即可。
 *
 * 落盘位置默认 `<cwd>/data/usage.jsonl`，可用 USAGE_LOG_PATH 覆盖
 * （容器部署时指到挂载卷，否则重新发布会丢历史）。
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  STATS_MAX_DAYS,
  STATS_MAX_RECORDS,
  costOf,
  type UsageDailyPoint,
  type UsageRecord,
  type UsageStats,
  type UsageStatus,
  type UsageUserStat,
} from './admin';

/** 单条提示词入库上限：防止有人粘贴整篇文章把账本撑爆 */
const PROMPT_MAX_CHARS = 400;

/** 读取上限：只保留最近 20000 行，超出的旧行不参与统计（文件本身不动） */
const MAX_LINES_SCANNED = 20_000;

/** 日期分桶固定按北京时间（UTC+8）——服务器时区常是 UTC，直接用本地日期会把当天从下午割开 */
const CN_OFFSET_MS = 8 * 60 * 60 * 1000;

function usageFilePath(): string {
  return (
    process.env.USAGE_LOG_PATH ?? path.resolve(process.cwd(), 'data', 'usage.jsonl')
  );
}

/** 北京时间的 YYYY-MM-DD */
function cnDate(ts: number): string {
  return new Date(ts + CN_OFFSET_MS).toISOString().slice(0, 10);
}

/** 追加一条用量。写失败只记日志，绝不能影响生成主链路 */
export async function appendUsage(input: {
  userId: string;
  prompt: string;
  status: UsageStatus;
  ts?: number;
}): Promise<void> {
  const record: UsageRecord = {
    ts: input.ts ?? Date.now(),
    userId: input.userId,
    prompt: input.prompt.replace(/\s+/g, ' ').trim().slice(0, PROMPT_MAX_CHARS),
    status: input.status,
  };
  const file = usageFilePath();
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (err) {
    console.error('[usage] 写入失败', err);
  }
}

function parseLine(line: string): UsageRecord | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const raw = JSON.parse(trimmed) as Partial<UsageRecord>;
    if (
      typeof raw.ts !== 'number' ||
      typeof raw.userId !== 'string' ||
      typeof raw.prompt !== 'string' ||
      (raw.status !== 'success' && raw.status !== 'failed')
    ) {
      return null;
    }
    return {
      ts: raw.ts,
      userId: raw.userId,
      prompt: raw.prompt,
      status: raw.status,
    };
  } catch {
    // 坏行（进程写到一半被杀）直接跳过，不让一行毁掉整个账本
    return null;
  }
}

/** 读取全部用量（旧→新）。文件不存在视为空账本 */
export async function readUsage(): Promise<UsageRecord[]> {
  const file = usageFilePath();
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const lines = text.split('\n');
  const scanned =
    lines.length > MAX_LINES_SCANNED ? lines.slice(-MAX_LINES_SCANNED) : lines;
  return scanned
    .map(parseLine)
    .filter((r): r is UsageRecord => r !== null)
    .sort((a, b) => a.ts - b.ts);
}

/**
 * 汇总：按身份、按北京时间日期、总量与消费。
 * 折线图补齐中间没有生成的空天（否则两点之间会被连成一条骗人的斜线）。
 */
export function aggregateUsage(records: UsageRecord[]): UsageStats {
  const userMap = new Map<string, UsageUserStat>();
  const dayMap = new Map<string, DayBucket>();

  for (const record of records) {
    const user = userMap.get(record.userId) ?? {
      userId: record.userId,
      total: 0,
      success: 0,
      failed: 0,
      cost: 0,
      lastAt: null,
    };
    user.total += 1;
    if (record.status === 'success') user.success += 1;
    else user.failed += 1;
    user.lastAt = user.lastAt === null ? record.ts : Math.max(user.lastAt, record.ts);
    userMap.set(record.userId, user);

    const key = cnDate(record.ts);
    const day = dayMap.get(key) ?? { total: 0, success: 0, users: {} };
    day.total += 1;
    if (record.status === 'success') day.success += 1;
    const slice = day.users[record.userId] ?? { total: 0, success: 0 };
    slice.total += 1;
    if (record.status === 'success') slice.success += 1;
    day.users[record.userId] = slice;
    dayMap.set(key, day);
  }

  const byUser = [...userMap.values()]
    .map((u) => ({ ...u, cost: costOf(u.success) }))
    .sort((a, b) => b.total - a.total);

  const daily = buildDailySeries(dayMap);

  const success = records.filter((r) => r.status === 'success').length;
  return {
    generatedAt: Date.now(),
    totals: {
      total: records.length,
      success,
      failed: records.length - success,
      cost: costOf(success),
    },
    byUser,
    daily,
    records: records.slice(-STATS_MAX_RECORDS).reverse(),
  };
}

interface DayBucket {
  total: number;
  success: number;
  users: Record<string, { total: number; success: number }>;
}

/** 从最早有记录的一天补到今天（最多 STATS_MAX_DAYS 天），空天补 0 */
function buildDailySeries(dayMap: Map<string, DayBucket>): UsageDailyPoint[] {
  const today = cnDate(Date.now());
  const keys = [...dayMap.keys()].sort();
  const earliest = keys[0] ?? today;

  const points: UsageDailyPoint[] = [];
  const cursor = new Date(`${earliest}T00:00:00Z`);
  const end = new Date(`${today}T00:00:00Z`);
  while (cursor.getTime() <= end.getTime()) {
    const date = cursor.toISOString().slice(0, 10);
    const day = dayMap.get(date) ?? { total: 0, success: 0, users: {} };
    points.push({
      date,
      total: day.total,
      success: day.success,
      cost: costOf(day.success),
      users: day.users,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return points.slice(-STATS_MAX_DAYS);
}
