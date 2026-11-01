import type { ComponentType, ReactNode } from 'react';

/**
 * The agent card: one anatomy for every card the agent puts in the stream —
 * a plan awaiting approval, a permission request, a finished plan.
 *
 * They were three bespoke layouts with three sets of paddings and three button
 * treatments, which is why a permission card and a plan card never looked like
 * the same product. One shape: solid `--surface-raised`, `--border-strong`,
 * `--shadow-sm`, `--radius-lg`, with a hairline-separated action row.
 */
export function AgentCard({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-[600px] overflow-hidden rounded-[var(--radius-lg)] border border-border-strong bg-surface-raised">
      {children}
    </div>
  );
}

/** Icon tile tone. `pending` is awaiting the user; `done` is settled. */
type CardTone = 'pending' | 'done' | 'failed';

const TILE_TONE: Record<CardTone, string> = {
  pending: 'bg-surface-inset text-text-muted',
  done: 'bg-surface-hover-solid text-status-ok',
  failed: 'bg-surface-hover-solid text-status-err',
};

/**
 * Title row: a tile, the title, and an optional state badge pushed right.
 * `mono` renders the subject (a command name, a file) in the mono face — it is
 * a literal the user has to recognise, not prose.
 */
export function AgentCardHeader({
  icon: Icon,
  tone = 'pending',
  title,
  mono,
  badge,
}: {
  icon: ComponentType<{ className?: string }>;
  tone?: CardTone;
  title: ReactNode;
  mono?: string;
  badge?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-[9px] px-[14px] py-3">
      <span
        className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[var(--radius-sm)] ${TILE_TONE[tone]}`}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 text-body tracking-body font-medium text-text">
        {title}
        {mono && (
          <span className="ml-1 font-mono text-tiny tracking-tiny font-normal text-text-muted">
            {mono}
          </span>
        )}
      </span>
      {badge && <span className="ml-auto shrink-0">{badge}</span>}
    </div>
  );
}

/** Rounded state badge for the header's trailing slot. */
export function AgentCardBadge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-border bg-surface-hover-solid px-[9px] py-0.5 text-tiny tracking-tiny font-normal text-status-ok">
      {children}
    </span>
  );
}

/** Prose under the title — what the agent is proposing, in a sentence. */
export function AgentCardOverview({ children }: { children: ReactNode }) {
  return <div className="px-[14px] pb-2.5 text-body tracking-body text-text-muted">{children}</div>;
}

/** A literal command, in the mono face on its own surface. */
export function AgentCardCommand({ children }: { children: ReactNode }) {
  return (
    <div className="mx-[14px] mb-3 overflow-x-auto whitespace-pre rounded-[var(--radius-sm)] bg-surface-inset px-2.5 py-2 font-mono text-tiny tracking-tiny text-text">
      {children}
    </div>
  );
}

/**
 * One step of a plan. Numbered while pending, struck through with a check once
 * done — the same row in both states, so an approved plan reads as the plan
 * that was approved rather than as a new list.
 */
export function AgentCardStep({
  index,
  done = false,
  children,
}: {
  index: number;
  done?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-[9px] border-t border-border px-[14px] py-1.5 text-body tracking-body text-text-muted">
      {done ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-ok"
          aria-hidden
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
      ) : (
        <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-surface-hover-solid text-micro tracking-micro font-medium text-text-passive">
          {index}
        </span>
      )}
      <span className={done ? 'line-through' : undefined}>{children}</span>
    </div>
  );
}

/**
 * Action row. The hint takes `margin-left: auto`'s place as the first child,
 * which pins it left and groups every button hard right.
 */
export function AgentCardActions({ hint, children }: { hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-t border-border px-[14px] py-2.5">
      {hint && <span className="mr-auto text-tiny tracking-tiny text-text-passive">{hint}</span>}
      {children}
    </div>
  );
}

const BUTTON_BASE =
  'cursor-pointer rounded-[var(--radius-sm)] text-body tracking-body font-normal transition-[background,color,border-color] duration-100 disabled:cursor-default';

/** The one affirmative action, in monochrome. */
export function AgentCardPrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${BUTTON_BASE} border-none bg-action-bg px-3.5 py-1.5 text-action-fg hover:bg-action-bg-hover disabled:bg-action-bg-disabled disabled:text-action-fg-disabled`}
    >
      {children}
    </button>
  );
}

/** A secondary choice that is still a real action. */
export function AgentCardOutlineButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${BUTTON_BASE} border border-border bg-surface px-3 py-1.5 text-text hover:bg-surface-inset disabled:bg-action-bg-disabled disabled:text-action-fg-disabled`}
    >
      {children}
    </button>
  );
}

/** Declining. Quiet by default — it is never the recommended path. */
export function AgentCardGhostButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${BUTTON_BASE} border-none bg-transparent px-2.5 py-1.5 text-text-muted hover:text-text disabled:text-text-disabled`}
    >
      {children}
    </button>
  );
}
