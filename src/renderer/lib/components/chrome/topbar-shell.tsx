import type { ReactNode } from 'react';
import { cn } from '@renderer/utils/utils';

/**
 * The work item header rail: 36px, one bottom
 * hairline, surface0, and it drags the frameless window. Owned by no feature —
 * `WorkItemHeader` renders it for every viewer of a work item. Anything that
 * varies per surface (title, actions) is a child, not a prop.
 */
export function TopbarShell({
  className,
  testId,
  children,
}: {
  className?: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        'app-drag-region flex h-9 shrink-0 select-none items-center gap-2 border-b border-border bg-surface pl-3 pr-2',
        className
      )}
    >
      {children}
    </div>
  );
}

/** Pushes everything after it to the topbar's trailing edge. */
export function TopbarSpacer() {
  return <div className="flex-1" />;
}

/** Trailing action cluster. */
export function TopbarActions({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 items-center gap-2">{children}</div>;
}

/**
 * Title first, then the repo in muted type ("Homepage  chord"), not a
 * `repo / title` breadcrumb. `title` is a node:
 * the owner passes an editable InlineTitle, the participant a plain span.
 */
export function TopbarBreadcrumb({ repoBadge, title }: { repoBadge: string; title: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-body tracking-body">
      {title}
      {repoBadge && <span className="shrink-0 truncate text-text-muted">{repoBadge}</span>}
    </div>
  );
}

/** The outlined header control: 26px tall, hairline border, rounded-md. */
export const HEADER_OUTLINE_BUTTON =
  'flex h-[26px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-transparent px-2 text-body tracking-body text-text transition-colors hover:bg-surface-hover disabled:cursor-default disabled:text-text-disabled';

/** The borderless header icon control. */
export const HEADER_ICON_BUTTON =
  'flex size-[26px] shrink-0 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text';
