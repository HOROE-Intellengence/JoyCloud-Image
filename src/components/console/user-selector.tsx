'use client';

import { Check, ChevronDown, UserRound } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { USER_PLACEHOLDER, WORKFLOW_USERS, type WorkflowUser } from '@/lib/users';
import { cn } from '@/lib/utils';

interface UserSelectorProps {
  /** 空串表示未选择用户，按钮显示占位文案「请选择用户」并高亮提示 */
  userId: string;
  onChange: (userId: string) => void;
  disabled?: boolean;
}

export function UserBadge({
  user,
  active,
}: {
  user: WorkflowUser;
  active?: boolean;
}) {
  return (
    <span
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-sm border text-[11px]',
        active
          ? 'border-signal/50 bg-signal/15 text-signal'
          : 'border-border bg-background text-muted-foreground',
      )}
    >
      {user.name.charAt(0)}
    </span>
  );
}

export function UserSelector({ userId, onChange, disabled }: UserSelectorProps) {
  const current = WORKFLOW_USERS.find((u) => u.id === userId) ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          data-unselected={current ? undefined : ''}
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors',
            current
              ? 'border-border bg-background text-foreground'
              : 'border-signal/60 bg-signal/[0.06] text-signal',
            disabled ? 'cursor-not-allowed opacity-50' : 'hover:border-faint',
          )}
          title={
            current
              ? '切换运行用户，后端自动匹配对应密钥'
              : '必须先选择用户，否则无法调用工作流'
          }
        >
          <UserRound
            className={cn('size-3.5', current ? 'text-faint' : 'text-signal')}
          />
          <span>{current ? current.name : USER_PLACEHOLDER}</span>
          <ChevronDown
            className={cn('size-3', current ? 'text-faint' : 'text-signal')}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel className="font-mono text-[10px] tracking-[0.12em] text-faint">
          运行用户 · 自动选 KEY
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {WORKFLOW_USERS.map((user) => {
          const active = current !== null && user.id === current.id;
          return (
            <DropdownMenuItem
              key={user.id}
              onSelect={() => onChange(user.id)}
              className="flex items-center gap-2 text-xs"
            >
              <UserBadge user={user} active={active} />
              <span className={cn(active && 'text-signal')}>{user.name}</span>
              {active && <Check className="ml-auto size-3.5 text-signal" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
