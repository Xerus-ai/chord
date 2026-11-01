import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@renderer/utils/utils';

export interface SidebarCalloutAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  leading?: ReactNode;
}

/** The sidebar is narrow: two buttons side by side is all the row can hold legibly. */
const MAX_ACTIONS = 2;

const ACTION_BASE_CLASS =
  'flex h-7 flex-1 cursor-pointer items-center justify-center gap-1 rounded-md px-3 text-tiny tracking-tiny transition-colors disabled:bg-action-bg-disabled disabled:text-action-fg-disabled';

const ACTION_VARIANT_CLASS: Record<NonNullable<SidebarCalloutAction['variant']>, string> = {
  primary: 'bg-action-bg text-action-fg hover:bg-action-bg-hover',
  secondary: 'bg-surface-inset text-text-muted hover:bg-surface-hover-solid',
};

/**
 * A notice pinned in the sidebar, such as a failed work-item load: a title,
 * a line of detail, and at most two buttons to recover. Announced as an alert
 * so a screen reader hears it when it appears.
 */
export function SidebarCallout({
  title,
  description,
  icon,
  variant = 'default',
  actions,
  onDismiss,
}: {
  title?: string;
  description?: ReactNode;
  icon?: ReactNode;
  variant?: 'default' | 'error';
  actions?: readonly SidebarCalloutAction[];
  onDismiss?: () => void;
}) {
  const shownActions = actions?.slice(0, MAX_ACTIONS) ?? [];
  const hasHeader = Boolean(title || icon || onDismiss);

  return (
    <div
      role="alert"
      className={cn(
        'flex w-full flex-col gap-2 border-t px-4 py-3',
        variant === 'error' ? 'border-status-err-border' : 'border-border'
      )}
    >
      {hasHeader && (
        <div className="flex items-start gap-2">
          {icon && <span className="flex shrink-0 items-center justify-center">{icon}</span>}
          {title && (
            <span className="min-w-0 flex-1 text-body tracking-body font-normal text-text">
              {title}
            </span>
          )}
          {onDismiss && (
            <button
              aria-label="Dismiss"
              onClick={onDismiss}
              className="flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center text-text-muted transition-colors hover:text-text"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
      {description && (
        <div className="min-w-0 text-tiny tracking-tiny text-text-muted">{description}</div>
      )}
      {shownActions.length > 0 && (
        <div className="mt-2 flex gap-2">
          {shownActions.map((action) => (
            <button
              key={action.label}
              onClick={action.onClick}
              disabled={action.disabled}
              className={cn(ACTION_BASE_CLASS, ACTION_VARIANT_CLASS[action.variant ?? 'secondary'])}
            >
              {action.leading}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
