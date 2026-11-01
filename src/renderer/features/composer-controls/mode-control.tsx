import { Check, ChevronDown, ListTodo, Shield, ShieldAlert } from 'lucide-react';
import type { PermissionModeOption } from '@shared/permission-modes';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';

function ModeIcon({ mode, className }: { mode: PermissionModeOption; className: string }) {
  if (mode.isPlan) return <ListTodo className={className} />;
  if (mode.danger) return <ShieldAlert className={className} />;
  return <Shield className={className} />;
}

/** One background per tone: a transparent base alongside the plan tint would win the cascade. */
function triggerTone(mode: PermissionModeOption): string {
  if (mode.danger) return 'bg-transparent text-status-err hover:bg-surface-hover';
  if (mode.isPlan) return 'bg-selected-bg text-text';
  return 'bg-transparent text-text-muted hover:bg-surface-hover hover:text-text';
}

/**
 * How freely the agent may act, as one pill naming the session's mode; its
 * menu lists exactly the modes the agent offers for the selected model, each
 * with the agent's own description. Full-access modes carry the danger tone
 * on the pill and in the menu, so running without checks is never subtle.
 */
export function ModeControl({
  modes,
  current,
  onModeChange,
}: {
  modes: readonly PermissionModeOption[];
  current: PermissionModeOption;
  onModeChange: (modeId: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Permission mode — ${current.label}`}
        className={`inline-flex h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-full border-none px-2 text-tiny tracking-tiny transition-colors data-popup-open:bg-surface-hover ${triggerTone(current)}`}
      >
        <ModeIcon mode={current} className="size-3.5 shrink-0" />
        <span className="truncate">{current.label}</span>
        <ChevronDown className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-72">
        {modes.map((m) => (
          <DropdownMenuItem
            key={m.id}
            onClick={() => onModeChange(m.id)}
            className={m.danger ? 'text-status-err' : undefined}
          >
            <ModeIcon mode={m} className="size-3.5 shrink-0 self-start mt-0.5" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{m.label}</span>
              {m.description && (
                <span className="text-micro tracking-micro text-text-passive">{m.description}</span>
              )}
            </span>
            {m.id === current.id && <Check className="ml-auto size-3.5 shrink-0" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
