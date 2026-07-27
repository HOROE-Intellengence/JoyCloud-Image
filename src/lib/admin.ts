/**
 * 隐藏管理后台的共享常量与统计类型（前后端共用，**不含任何密钥**）。
 *
 * 入口刻意不做成独立路由或子域名：在顶栏「并发」输入框键入暗号 `&yyzb`，
 * 再点一次「开始生成」即进入后台——该次点击**不会**真的派发任务。
 * 暗号只是「不写在界面上的入口」，不是权限边界：本工作台部署在内网、
 * 且统计里没有 Token 之类的敏感物，够用即可（避免为此引入登录体系）。
 */

/** 后台入口暗号：键入并发框后触发一次生成即进入 */
export const ADMIN_CODE = '&yyzb';

/** 单张成品计价（元人民币） */
export const PRICE_PER_IMAGE = 0.12;

/** 折线图展示的最大天数（按北京时间分桶） */
export const STATS_MAX_DAYS = 30;

/** 流水表返回的最大条数（新→旧） */
export const STATS_MAX_RECORDS = 300;

export function isAdminCode(raw: string): boolean {
  return raw.trim().toLowerCase() === ADMIN_CODE;
}

/** 一次落地的生成结果；`failed` 不计费 */
export type UsageStatus = 'success' | 'failed';

export interface UsageRecord {
  /** 落地时刻（epoch ms） */
  ts: number;
  /** 身份 id，对应 WORKFLOW_USERS */
  userId: string;
  /** 提交的提示词（写入时已截断） */
  prompt: string;
  status: UsageStatus;
}

export interface UsageUserStat {
  userId: string;
  total: number;
  success: number;
  failed: number;
  /** success × PRICE_PER_IMAGE */
  cost: number;
  lastAt: number | null;
}

/** 折线图上的一天（date 为北京时间 YYYY-MM-DD） */
export interface UsageDailyPoint {
  date: string;
  total: number;
  success: number;
  cost: number;
  /** 当天各身份的分量，供后台按身份筛选时重画折线 */
  users: Record<string, { total: number; success: number }>;
}

export interface UsageStats {
  generatedAt: number;
  totals: { total: number; success: number; failed: number; cost: number };
  byUser: UsageUserStat[];
  daily: UsageDailyPoint[];
  /** 最近 STATS_MAX_RECORDS 条流水，新→旧 */
  records: UsageRecord[];
}

/** 计价：只有出图成功的才算钱 */
export function costOf(successCount: number): number {
  return Math.round(successCount * PRICE_PER_IMAGE * 100) / 100;
}

/** 金额展示：¥12.34 */
export function formatMoney(amount: number): string {
  return `¥${amount.toFixed(2)}`;
}
