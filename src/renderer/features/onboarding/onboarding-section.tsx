import { AlertTriangle, Check, Clock } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@renderer/utils/utils';

/**
 * Where a section stands. `next` is not the section's to decide — the page
 * lifts the first one the user can act on (see `summarizeProgress`) — so it
 * arrives separately as `isNext` and only affects an unfinished section.
 */
export type SectionState = 'todo' | 'done' | 'pending' | 'error';

/** A time estimate renders with a clock; a label ("Optional") renders bare. */
export type SectionMeta = { kind: 'estimate'; label: string } | { kind: 'label'; label: string };

function StepBadge({
  index,
  state,
  isNext,
}: {
  index: number;
  state: SectionState;
  isNext: boolean;
}) {
  if (state === 'pending') {
    return (
      <span
        aria-label="In progress"
        className="size-5 shrink-0 animate-spin rounded-full border-2 border-border border-t-status-running"
      />
    );
  }
  if (state === 'error') {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center text-status-err">
        <AlertTriangle className="size-icon-sm" aria-label="Needs attention" />
      </span>
    );
  }
  if (state === 'done') {
    // The checked contract from `lib/ui/checkbox.tsx`: a filled
    // --selected-border carrying a --selected-fg glyph.
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-selected-border text-selected-fg">
        <Check className="size-3" strokeWidth={3} aria-label="Done" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-full text-tiny tracking-tiny font-semibold tabular-nums',
        isNext
          ? 'ring-[1.5px] ring-text ring-inset text-text'
          : 'bg-surface-inset text-text-passive'
      )}
    >
      {index + 1}
    </span>
  );
}

/**
 * One onboarding step: a checklist header over a recessed shell that holds a
 * raised card of rows, with an optional footer line for hints and errors.
 * The first section the user can act on is lifted; finished ones settle flat
 * and show their answer in the header, so the page reads as a summary once
 * it is done.
 */
export function OnboardingSection({
  index,
  title,
  meta,
  description,
  state,
  isNext,
  answer,
  footer,
  children,
}: {
  index: number;
  title: string;
  meta: SectionMeta;
  description: string;
  state: SectionState;
  isNext: boolean;
  answer?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const lifted = isNext && state !== 'done';
  return (
    <section
      aria-labelledby={`onboarding-step-${index}`}
      className={cn(
        'rounded-xl border bg-surface-canvas p-1 transition-[border-color,box-shadow] duration-200',
        lifted ? 'border-border shadow-[var(--shadow-lift)]' : 'border-border-subtle'
      )}
    >
      <header className="flex gap-3 p-3">
        <StepBadge index={index} state={state} isNext={lifted} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2
              id={`onboarding-step-${index}`}
              className={cn(
                'text-body tracking-body font-semibold',
                state === 'done' ? 'text-text-muted' : 'text-text'
              )}
            >
              {title}
            </h2>
            <span className="flex items-center gap-1 text-tiny tracking-tiny text-text-passive">
              {meta.kind === 'estimate' && <Clock className="size-3" />}
              {meta.label}
            </span>
          </div>
          <p className="mt-0.5 text-tiny tracking-tiny text-text-passive">{description}</p>
        </div>
        {answer && (
          <span className="shrink-0 whitespace-nowrap text-tiny tracking-tiny text-text-passive">
            {answer}
          </span>
        )}
      </header>
      <div
        className={cn(
          'overflow-hidden rounded-lg border bg-surface-raised',
          lifted ? 'border-border-strong' : 'border-border'
        )}
      >
        {children}
      </div>
      {footer}
    </section>
  );
}

/** Hint or error line under the card, inside the shell. */
export function SectionFooter({
  tone = 'hint',
  children,
}: {
  tone?: 'hint' | 'error';
  children: ReactNode;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className={cn(
        'flex items-center gap-1.5 px-3 pt-2 pb-1.5 text-tiny tracking-tiny',
        tone === 'error' ? 'text-status-err' : 'text-text-passive'
      )}
    >
      {tone === 'error' && <AlertTriangle className="size-icon-xs shrink-0" />}
      {children}
    </div>
  );
}

/** Quiet inline action at the end of a footer line ("Keep it", "Retry"). */
export function FooterAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ml-auto shrink-0 rounded-xs font-medium text-text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-selected-border"
    >
      {children}
    </button>
  );
}

/** A card row: optional leading tile, label and detail on the left, control on the right. */
export function SectionRow({
  leading,
  label,
  detail,
  detailMono,
  control,
  className,
}: {
  leading?: ReactNode;
  label: ReactNode;
  detail?: ReactNode;
  detailMono?: boolean;
  control?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-h-14 items-center gap-3 px-3.5 py-2.5 [&+&]:border-t [&+&]:border-border-subtle',
        className
      )}
    >
      {leading}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-body tracking-body font-medium text-text">
          {label}
        </div>
        {detail && (
          <div
            className={cn(
              'truncate text-tiny tracking-tiny text-text-passive',
              detailMono && 'font-mono'
            )}
          >
            {detail}
          </div>
        )}
      </div>
      {control && <div className="flex shrink-0 items-center gap-1.5">{control}</div>}
    </div>
  );
}

/** The small outlined label beside a row or agent name ("Optional", "Default"). */
export function RowTag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-4.5 items-center rounded-xs border border-border px-1.5 text-micro tracking-micro font-medium text-text-passive">
      {children}
    </span>
  );
}

/** The square behind a logo or icon at the start of a row. */
export function RowTile({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'flex size-7.5 shrink-0 items-center justify-center rounded-md bg-surface-inset text-text-muted',
        className
      )}
    >
      {children}
    </span>
  );
}

/** Status text on the right of a row once it no longer needs an action. */
export function RowStatus({ children }: { children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap text-tiny tracking-tiny text-text-muted">
      <Check className="size-icon-xs text-status-ok" strokeWidth={2.5} />
      {children}
    </span>
  );
}

/** A skeleton row at the height of a real one. */
export function RowSkeleton() {
  return (
    <div className="skeleton h-14 w-full rounded-none [&+&]:border-t [&+&]:border-border-subtle" />
  );
}
