import type { ComponentType, ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';

/**
 * Wraps a control the caller lacks the capability to use so hovering it
 * explains WHY. Two details carry the whole thing: the gated control uses
 * `aria-disabled`, not `disabled` — a `disabled` button emits no pointer
 * events, so its tooltip would never open and the reason would be unreachable
 * — and the trigger is a plain span wrapper, so the button inside stays a
 * button. Callers must still drop their own handler; see `blockedBy` below.
 */
export function CapabilityTooltip({ reason, children }: { reason: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger className="inline-flex h-auto cursor-default" render={<span />}>
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">{reason}</TooltipContent>
    </Tooltip>
  );
}

const ACTION_CLASSES =
  'flex cursor-pointer items-center gap-1 rounded-xs border-none bg-transparent px-2 py-0 text-body tracking-body font-medium text-text-passive transition-[color,background] duration-100 ease-out hover:bg-surface-hover-solid hover:text-text-muted';
const BLOCKED_CLASSES =
  'flex cursor-default items-center gap-1 rounded-xs border-none bg-transparent px-2 py-0 text-body tracking-body font-medium text-text-passive opacity-60 transition-[color,background] duration-100 ease-out';

/**
 * A topbar action (Share, panel toggle, new terminal). When `blockedBy` is
 * set the control still renders in place — same size, same position — as a
 * dimmed, non-activating button whose tooltip carries the reason. Controls a
 * role cannot use are shown, not hidden: a participant seeing a greyed-out
 * Share learns the feature exists and that the owner holds it.
 */
export function ChromeActionButton({
  icon: Icon,
  label,
  onClick,
  title,
  blockedBy,
  ariaLabel,
}: {
  icon: ComponentType<{ className?: string }>;
  label?: ReactNode;
  onClick?: () => void;
  /** Native hover hint for the ENABLED state. Ignored when blocked. */
  title?: string;
  /** Why this caller cannot use the control; renders it inert with a tooltip. */
  blockedBy?: string;
  ariaLabel?: string;
}) {
  const button = (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-disabled={blockedBy ? true : undefined}
      title={blockedBy ? undefined : title}
      onClick={blockedBy ? undefined : onClick}
      className={blockedBy ? BLOCKED_CLASSES : ACTION_CLASSES}
      style={{ minHeight: 28 }}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );

  if (!blockedBy) return button;
  return <CapabilityTooltip reason={blockedBy}>{button}</CapabilityTooltip>;
}
