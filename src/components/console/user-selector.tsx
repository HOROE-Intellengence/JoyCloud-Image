'use client';

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
  /** 空串表示未选择用户，按钮显示占位文案「请选择用户」并走洋红待办描边 */
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
        'flex size-5 shrink-0 items-center justify-center border text-[11px]',
        active
          ? 'border-signal bg-teal-wash text-teal-deep'
          : 'border-rule bg-paper text-quiet',
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
            'flex items-center gap-2.5 rounded-sm border bg-transparent px-3 pb-1.5 pt-[5px] font-sans text-[15px] transition-colors',
            current
              ? 'border-foreground text-foreground'
              : 'border-rose text-rose-deep',
            disabled
              ? 'cursor-not-allowed opacity-50'
              : current
                ? 'hover:bg-sunk'
                : 'hover:bg-rose-wash',
          )}
          title={
            current
              ? '切换运行用户，后端自动匹配对应密钥'
              : '必须先选择用户，否则无法调用工作流'
          }
        >
          <span>{current ? current.name : USER_PLACEHOLDER}</span>
          <span className="text-[11px] opacity-70">▾</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-44 rounded-sm border-foreground bg-raised font-sans"
      >
        <DropdownMenuLabel className="text-[11px] font-normal tracking-[0.12em] text-quiet">
          运行用户 · 自动选 KEY
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-rule" />
        {WORKFLOW_USERS.map((user) => {
          const active = current !== null && user.id === current.id;
          return (
            <DropdownMenuItem
              key={user.id}
              onSelect={() => onChange(user.id)}
              className="flex items-center gap-2 rounded-sm text-[14px]"
            >
              <UserBadge user={user} active={active} />
              <span className={cn(active && 'text-teal-deep')}>{user.name}</span>
              {active && (
                <span className="ml-auto text-[11px] text-teal-deep">当前</span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
