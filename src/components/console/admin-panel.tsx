'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ADMIN_CODE,
  PRICE_PER_IMAGE,
  STATS_MAX_RECORDS,
  costOf,
  formatMoney,
  type UsageDailyPoint,
  type UsageStats,
} from '@/lib/admin';
import { WORKFLOW_USERS } from '@/lib/users';
import { cn } from '@/lib/utils';

interface AdminPanelProps {
  open: boolean;
  onClose: () => void;
}

/** 'all' = 不筛身份 */
type UserFilter = string;

function userName(userId: string): string {
  return WORKFLOW_USERS.find((u) => u.id === userId)?.name ?? userId;
}

function formatStamp(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 隐藏管理后台：不占独立路由/子域名，只在暗号触发后覆盖在工作台之上。
 * 数据来自服务端 JSONL 账本（lib/usage-store.ts），本组件只做展示与筛选。
 */
export function AdminPanel({ open, onClose }: AdminPanelProps) {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<UserFilter>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(
        `/api/usage?code=${encodeURIComponent(ADMIN_CODE)}`,
        { cache: 'no-store' },
      );
      const data = (await resp.json()) as UsageStats & { error?: string };
      if (!resp.ok) throw new Error(data.error ?? `HTTP ${resp.status}`);
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取用量账本失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    // 后台是整页覆盖：锁住身后工作台的滚动，否则滚轮会穿透到下面那一页
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  /** 身份筛选后的折线数据：从每天的 users 分量里取该身份 */
  const points = useMemo<UsageDailyPoint[]>(() => {
    if (!stats) return [];
    if (filter === 'all') return stats.daily;
    return stats.daily.map((p) => {
      const slice = p.users[filter] ?? { total: 0, success: 0 };
      return {
        date: p.date,
        total: slice.total,
        success: slice.success,
        cost: costOf(slice.success),
        users: p.users,
      };
    });
  }, [stats, filter]);

  const records = useMemo(() => {
    if (!stats) return [];
    return filter === 'all'
      ? stats.records
      : stats.records.filter((r) => r.userId === filter);
  }, [stats, filter]);

  const scope = useMemo(() => {
    if (!stats) return null;
    if (filter === 'all') return stats.totals;
    const row = stats.byUser.find((u) => u.userId === filter);
    return row
      ? { total: row.total, success: row.success, failed: row.failed, cost: row.cost }
      : { total: 0, success: 0, failed: 0, cost: 0 };
  }, [stats, filter]);

  if (!open) return null;

  const filterOptions: UserFilter[] = [
    'all',
    ...WORKFLOW_USERS.map((u) => u.id),
    ...(stats?.byUser ?? [])
      .map((u) => u.userId)
      .filter((id) => !WORKFLOW_USERS.some((u) => u.id === id)),
  ];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-paper px-5 pb-[60px] text-foreground lg:px-10">
      <header className="pt-[26px] font-sans">
        <div className="flex flex-wrap items-baseline justify-between gap-x-10 gap-y-3">
          <div className="flex items-baseline gap-3.5">
            <h1 className="m-0 text-2xl font-semibold leading-none tracking-[0.01em]">
              用量总账
            </h1>
            <span className="text-[13px] tracking-[0.04em] text-quiet">
              JoyCloud Ledger · 内部后台
            </span>
          </div>
          <div className="flex items-center gap-6 text-[13px]">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="bg-transparent text-teal-deep transition-colors hover:text-rose disabled:text-rule-dash"
            >
              {loading ? '读取中…' : '刷新'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-sm border border-foreground bg-transparent px-4 py-[7px] text-foreground transition-colors hover:bg-foreground hover:text-paper"
            >
              返回工作台
            </button>
          </div>
        </div>

        <div className="mt-3.5 h-px bg-foreground" />

        <div className="flex flex-wrap items-center gap-x-7 gap-y-1 py-2 text-xs tracking-[0.04em] text-muted-foreground">
          <span>
            计价 <span className="tabular-nums">{PRICE_PER_IMAGE.toFixed(2)}</span> 元 / 张 · 只算成功出图
          </span>
          <span>日期按北京时间分桶</span>
          <span>
            流水保留最近{' '}
            <span className="tabular-nums">{STATS_MAX_RECORDS}</span> 条
          </span>
          {stats && (
            <span className="ml-auto tabular-nums">
              取数于 {formatStamp(stats.generatedAt)}
            </span>
          )}
        </div>

        <div className="h-px bg-rule" />
      </header>

      {error !== null && (
        <p className="mt-6 rounded-sm border border-rose bg-rose-wash px-4 py-3 text-sm text-rose-deep">
          {error}
        </p>
      )}

      {stats === null ? (
        <p className="mt-10 text-[15px] italic text-quiet">
          {loading ? '正在读取账本…' : '暂无数据。'}
        </p>
      ) : (
        <div className="pt-[30px]">
          {/* 身份筛选：整页（汇总数、折线、流水）都跟着走 */}
          <div className="mb-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <span className="text-xs uppercase tracking-[0.14em] text-quiet">
              身份
            </span>
            {filterOptions.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                className={cn(
                  'bg-transparent transition-colors',
                  filter === id
                    ? 'text-foreground underline underline-offset-4'
                    : 'text-teal-deep hover:text-rose',
                )}
              >
                {id === 'all' ? '全部' : userName(id)}
              </button>
            ))}
          </div>

          {scope && (
            <div className="flex flex-wrap gap-x-16 gap-y-6 border-b border-rule pb-7">
              <Metric label="派发总数" value={String(scope.total)} unit="张" />
              <Metric label="成功出图" value={String(scope.success)} unit="张" />
              <Metric
                label="失败"
                value={String(scope.failed)}
                unit="张"
                tone={scope.failed > 0 ? 'text-rose' : undefined}
              />
              <Metric label="合计消费" value={formatMoney(scope.cost)} />
            </div>
          )}

          <section className="pt-8">
            <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-3">
              <span className="text-xs uppercase tracking-[0.14em] text-quiet">
                每日出图
              </span>
              <span className="flex items-center gap-4 text-xs text-quiet">
                <LegendMark className="bg-rule-dash" label="派发" />
                <LegendMark className="bg-signal" label="成功出图" />
              </span>
            </div>
            <DailyChart points={points} />
          </section>

          <section className="pt-10">
            <div className="mb-2.5 text-xs uppercase tracking-[0.14em] text-quiet">
              各身份用量
            </div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-foreground text-left text-xs tracking-[0.1em] text-quiet">
                  <th className="py-2 font-normal">身份</th>
                  <th className="py-2 text-right font-normal">派发</th>
                  <th className="py-2 text-right font-normal">成功</th>
                  <th className="py-2 text-right font-normal">失败</th>
                  <th className="py-2 text-right font-normal">消费</th>
                  <th className="py-2 text-right font-normal">最近一次</th>
                </tr>
              </thead>
              <tbody>
                {stats.byUser.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-3 text-[13px] italic text-faint">
                      还没有任何生成记录。
                    </td>
                  </tr>
                ) : (
                  stats.byUser.map((row) => (
                    <tr
                      key={row.userId}
                      className={cn(
                        'border-b border-rule-soft tabular-nums',
                        filter !== 'all' && filter !== row.userId && 'text-quiet',
                      )}
                    >
                      <td className="py-2">{userName(row.userId)}</td>
                      <td className="py-2 text-right">{row.total}</td>
                      <td className="py-2 text-right">{row.success}</td>
                      <td
                        className={cn(
                          'py-2 text-right',
                          row.failed > 0 && 'text-rose',
                        )}
                      >
                        {row.failed}
                      </td>
                      <td className="py-2 text-right">{formatMoney(row.cost)}</td>
                      <td className="py-2 text-right text-quiet">
                        {row.lastAt === null ? '—' : formatStamp(row.lastAt)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>

          <section className="pt-10">
            <div className="mb-2.5 flex items-baseline justify-between gap-3">
              <span className="text-xs uppercase tracking-[0.14em] text-quiet">
                提示词流水
              </span>
              <span className="text-xs tabular-nums text-quiet">
                {records.length} 条
              </span>
            </div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-foreground text-left text-xs tracking-[0.1em] text-quiet">
                  <th className="w-[110px] py-2 font-normal">时间</th>
                  <th className="w-[90px] py-2 font-normal">身份</th>
                  <th className="w-[70px] py-2 font-normal">结果</th>
                  <th className="py-2 font-normal">提示词</th>
                </tr>
              </thead>
              <tbody>
                {records.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-3 text-[13px] italic text-faint">
                      该身份下暂无流水。
                    </td>
                  </tr>
                ) : (
                  records.map((record, i) => (
                    <tr
                      key={`${record.ts}-${i}`}
                      className="border-b border-rule-soft align-top"
                    >
                      <td className="py-2 tabular-nums text-quiet">
                        {formatStamp(record.ts)}
                      </td>
                      <td className="py-2">{userName(record.userId)}</td>
                      <td
                        className={cn(
                          'py-2 font-mono text-xs',
                          record.status === 'success'
                            ? 'text-teal-deep'
                            : 'text-rose-deep',
                        )}
                      >
                        {record.status === 'success' ? 'OK' : 'FAILED'}
                      </td>
                      <td className="py-2 leading-[1.5]" title={record.prompt}>
                        {record.prompt || <span className="text-faint">（空）</span>}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>

          <p className="mt-8 text-[13px] italic text-quiet">
            账本以一行一条 JSON 追加在服务端 data/usage.jsonl，删文件即清账；Esc 返回工作台。
          </p>
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: string;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-[0.14em] text-quiet">{label}</div>
      <div className={cn('mt-1 text-[30px] leading-none tabular-nums', tone)}>
        {value}
        {unit && <span className="ml-1 text-sm text-quiet">{unit}</span>}
      </div>
    </div>
  );
}

function LegendMark({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('inline-block h-px w-4', className)} />
      {label}
    </span>
  );
}

/* ── 折线图 ─────────────────────────────────────────────────
   手绘 SVG 而不是引图表库：这里只要两条 1px 折线 + 一条基线，
   图表库的默认卡片/圆角/阴影反而要一路改回来（见 DESIGN.md 禁忌）。 */

const VIEW_W = 720;
const VIEW_H = 190;
const PAD_L = 36;
const PAD_R = 10;
const PAD_T = 14;
const PAD_B = 26;

function DailyChart({ points }: { points: UsageDailyPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  if (points.length === 0) {
    return (
      <div className="flex h-[190px] items-center justify-center rounded-sm border border-dashed border-rule-dash text-[13px] italic text-faint">
        还没有可统计的日期。
      </div>
    );
  }

  const yMax = Math.max(1, ...points.map((p) => p.total));
  const innerW = VIEW_W - PAD_L - PAD_R;
  const innerH = VIEW_H - PAD_T - PAD_B;
  const x = (i: number) =>
    points.length === 1 ? PAD_L + innerW / 2 : PAD_L + (i / (points.length - 1)) * innerW;
  const y = (v: number) => PAD_T + innerH - (v / yMax) * innerH;

  const line = (pick: (p: UsageDailyPoint) => number) =>
    points.map((p, i) => `${x(i).toFixed(1)},${y(pick(p)).toFixed(1)}`).join(' ');

  // x 轴只标首/中/尾，避免 30 天挤成一片
  const tickIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  const active = hover !== null ? points[hover] : null;

  return (
    <div>
      <div className="mb-1 h-4 text-xs tabular-nums text-muted-foreground">
        {active && (
          <span>
            {active.date} · 派发 {active.total} 张 · 成功 {active.success} 张 ·{' '}
            {formatMoney(active.cost)}
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="w-full"
        role="img"
        aria-label="每日出图折线图"
        onMouseLeave={() => setHover(null)}
      >
        {/* 三档横向刻度：0 / 半程 / 峰值；峰值很小时半程会与两端重合，去重免得标出「0 1 1」 */}
        {[...new Set([0, Math.round(yMax / 2), yMax])].map((value) => {
          const ratio = value / yMax;
          const yy = y(value);
          return (
            <g key={value}>
              <line
                x1={PAD_L}
                x2={VIEW_W - PAD_R}
                y1={yy}
                y2={yy}
                stroke={ratio === 0 ? 'var(--rule)' : 'var(--rule-soft)'}
                strokeWidth={1}
              />
              <text
                x={PAD_L - 6}
                y={yy + 3}
                textAnchor="end"
                fontSize={9}
                fill="var(--quiet)"
              >
                {value}
              </text>
            </g>
          );
        })}

        {active && hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={PAD_T}
            y2={PAD_T + innerH}
            stroke="var(--rule-dash)"
            strokeWidth={1}
          />
        )}

        <polyline
          points={line((p) => p.total)}
          fill="none"
          stroke="var(--rule-dash)"
          strokeWidth={1}
        />
        <polyline
          points={line((p) => p.success)}
          fill="none"
          stroke="var(--signal)"
          strokeWidth={1.5}
        />

        {points.length <= 40 &&
          points.map((p, i) => (
            <circle
              key={p.date}
              cx={x(i)}
              cy={y(p.success)}
              r={hover === i ? 3 : 1.8}
              fill="var(--signal)"
            />
          ))}

        {tickIndexes.map((i) => (
          <text
            key={points[i].date}
            x={x(i)}
            y={VIEW_H - 8}
            textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
            fontSize={9}
            fill="var(--quiet)"
          >
            {points[i].date.slice(5)}
          </text>
        ))}

        {/* 透明热区：每天一条，鼠标扫过即读数 */}
        {points.map((p, i) => (
          <rect
            key={`hit-${p.date}`}
            x={points.length === 1 ? PAD_L : x(i) - innerW / points.length / 2}
            y={PAD_T}
            width={points.length === 1 ? innerW : innerW / points.length}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>
    </div>
  );
}
