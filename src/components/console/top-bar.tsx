'use client';

import { useEffect, useState } from 'react';
import { Aperture } from 'lucide-react';
import { UserSelector } from './user-selector';

interface TopBarProps {
  /** 是否有批次在跑（拆分中/生成中） */
  active: boolean;
  userId: string;
  onUserChange: (userId: string) => void;
}

type ServiceStatus = 'checking' | 'ok' | 'down' | 'unselected';

export function TopBar({ active, userId, onUserChange }: TopBarProps) {
  const [service, setService] = useState<ServiceStatus>('checking');

  useEffect(() => {
    // 未选择用户时不去探活：上游对无 Token 请求必然 401，探活结果没有参考价值
    if (!userId) {
      setService('unselected');
      return;
    }
    let alive = true;
    setService('checking');
    const check = async () => {
      try {
        const resp = await fetch(
          `/api/health?user_id=${encodeURIComponent(userId)}`,
          { cache: 'no-store' },
        );
        const data = (await resp.json()) as { status?: string };
        if (alive) setService(data.status === 'ok' ? 'ok' : 'down');
      } catch {
        if (alive) setService('down');
      }
    };
    check();
    const timer = setInterval(check, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [userId]);

  const dotClass = active
    ? 'bg-signal animate-signal-pulse'
    : service === 'ok'
      ? 'bg-success'
      : service === 'down'
        ? 'bg-destructive'
        : 'bg-faint';

  const statusText = active
    ? 'RUNNING'
    : service === 'ok'
      ? 'ONLINE'
      : service === 'down'
        ? 'OFFLINE'
        : service === 'unselected'
          ? 'NO USER'
          : 'CHECKING';

  return (
    <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-border bg-panel px-4">
      <div className="flex items-center gap-3">
        <div className="flex size-7 items-center justify-center rounded-md bg-signal">
          <Aperture className="size-4 text-signal-foreground" strokeWidth={2} />
        </div>
        <div className="flex items-baseline gap-2.5">
          <span className="text-[15px] font-semibold tracking-[0.02em] text-foreground">
            云悦资本图像生成
          </span>
          <span className="hidden font-mono text-xs tracking-[0.14em] text-muted-foreground sm:inline">
            JoyCloud Image
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
          <span className={`size-1.5 rounded-full ${dotClass}`} />
          <span className="font-mono text-[11px] text-muted-foreground">
            {statusText}
          </span>
        </div>

        <UserSelector userId={userId} onChange={onUserChange} />
      </div>
    </header>
  );
}
