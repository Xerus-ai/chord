import { ArrowUp, Square } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { CapabilityTooltip } from './chrome-action-button';

/**
 * The composer dock: a full-width strip anchored to the bottom of its pane.
 * No top border: the card is the only edge the composer draws.
 *
 * In-flow, not absolutely positioned. A floating island over a gradient made
 * the composer a second surface hovering on top of the pane, and forced every
 * host to reserve a matching strip of empty space underneath the transcript.
 * design.md §7: workspace and chat surfaces use the full width, and the
 * composer holds its content to MAX_CONTENT_WIDTH so lines stay readable while
 * the working surface fills the rest.
 */
export function ComposerDock({ children }: { children: ReactNode }) {
  return (
    <div className="shrink-0 bg-surface px-4 pb-4 pt-2">
      <div className="mx-auto w-full max-w-[var(--max-content-width)]">{children}</div>
    </div>
  );
}

/**
 * The input card: surface1, one accent
 * hairline, 16px radius and padding, 12px between the text and the button row.
 * Focus only strengthens the border. `relative` is load-bearing: the
 * slash-command and mention menus render inside as `absolute bottom-full`.
 */
export function ComposerSurface({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex flex-col gap-3 rounded-2xl border border-border-strong bg-surface-raised p-4 transition-[border-color] duration-200 ease-in-out focus-within:border-border-strong">
      {children}
    </div>
  );
}

/** The button row under the text: leading controls, a spacer, trailing send. */
export function ComposerActionRow({ children }: { children: ReactNode }) {
  return (
    // Wraps rather than clips, so a narrow pane never pushes the last
    // controls out of reach. -6px lets ghost controls' ink align with the text.
    <div className="-mx-1.5 flex min-w-0 flex-wrap items-center gap-x-0.5 gap-y-1">{children}</div>
  );
}

/** Separates leading action pills from trailing controls. */
export function ComposerActionSpacer() {
  return <div className="flex-1" />;
}

/** Hairline divider between adjacent action pills. */
export function ComposerActionDivider() {
  return <div className="mx-1 h-[14px] w-px bg-border" />;
}

/** Caption strip under the dock (keyboard hints, access notices, progress). */
export function ComposerHintRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3 pt-2" style={{ minHeight: 22 }}>
      {children}
    </div>
  );
}

/**
 * Bordered and fully rounded, matching PlanModePill/EffortPill — the leading
 * actions and the trailing pills sit in one row, and two pill shapes in that
 * row read as two unrelated kinds of control.
 */
// `font-normal`, not medium: medium is reserved for the structural-label tier
// (section labels, modal titles, dense metadata emphasis). Button and pill
// labels live inside a surface, so they are normal weight — design.md §14.
const PILL_BASE =
  'inline-flex min-w-0 items-center gap-1 whitespace-nowrap rounded-full border border-transparent bg-transparent px-2 py-0 text-tiny tracking-tiny font-normal transition-[color,border-color,background] duration-[80ms] ease-[cubic-bezier(0.25,1,0.5,1)]';

/** A leading composer action (Accept edits, Link issue, Send to agent). */
export function ComposerActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  blockedBy,
  title,
  ariaLabel,
}: {
  icon: ComponentType<{ className?: string }>;
  label?: ReactNode;
  onClick?: () => void;
  /** Transient unavailability (in flight, empty draft) — no tooltip. */
  disabled?: boolean;
  /** A capability this caller lacks — renders inert with a reason tooltip. */
  blockedBy?: string;
  title?: string;
  ariaLabel?: string;
}) {
  const button = (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-disabled={blockedBy ? true : undefined}
      disabled={!blockedBy && disabled}
      title={blockedBy ? undefined : title}
      onClick={blockedBy ? undefined : onClick}
      className={`${PILL_BASE} ${
        blockedBy
          ? 'cursor-default opacity-50'
          : 'cursor-pointer text-text-muted hover:bg-surface-hover hover:text-text disabled:cursor-default disabled:text-text-disabled'
      }`}
      style={{ minHeight: 28 }}
    >
      <Icon className={label ? 'size-icon-xs shrink-0' : 'size-icon-md shrink-0'} />
      {label}
    </button>
  );

  if (!blockedBy) return button;
  return <CapabilityTooltip reason={blockedBy}>{button}</CapabilityTooltip>;
}

/**
 * Takes the send button's place while a turn is streaming. One control in one
 * slot: the alternative is a live send button beside a stop button, which is
 * exactly the second-send-mid-stream the swap exists to prevent.
 */
export function ComposerStopButton({
  onClick,
  disabled,
}: {
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Stop the agent"
      title="Stop the agent"
      className="ml-1 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-surface-hover-solid text-text transition-[background,transform] duration-100 hover:bg-surface-active-solid active:scale-[0.94] disabled:cursor-default disabled:bg-action-bg-disabled disabled:text-action-fg-disabled"
    >
      <Square className="h-[11px] w-[11px] fill-current" />
    </button>
  );
}

/** The round trailing send button. */
export function ComposerSendButton({
  onClick,
  disabled,
  blockedBy,
  ariaLabel = 'Send message',
  title,
}: {
  onClick?: () => void;
  disabled?: boolean;
  blockedBy?: string;
  ariaLabel?: string;
  title?: string;
}) {
  const button = (
    <button
      type="button"
      onClick={blockedBy ? undefined : onClick}
      aria-disabled={blockedBy ? true : undefined}
      disabled={!blockedBy && disabled}
      aria-label={ariaLabel}
      title={blockedBy ? undefined : title}
      // Send: 28px, round, the accent fill, the one CTA on the surface.
      className={`ml-1 flex size-7 shrink-0 items-center justify-center rounded-full border-none transition-[background,transform,filter] duration-100 ${
        blockedBy
          ? 'cursor-default bg-surface-hover-solid opacity-50'
          : 'cursor-pointer bg-action-bg text-action-fg hover:brightness-110 active:scale-[0.94] disabled:cursor-default disabled:bg-action-bg-disabled disabled:text-action-fg-disabled'
      }`}
    >
      <ArrowUp className="size-icon-sm" />
    </button>
  );

  if (!blockedBy) return button;
  return <CapabilityTooltip reason={blockedBy}>{button}</CapabilityTooltip>;
}
