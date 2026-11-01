import type { ComponentType, ReactNode } from 'react';
import { cn } from '@renderer/utils/utils';

export type SegmentedControlSize = 'xs' | 'sm' | 'md';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  /** Present the segment as unavailable, with a reason in its tooltip. */
  disabledReason?: string;
}

/**
 * A row of mutually exclusive options sharing one shell.
 *
 * Sizes are the shared control contract (`--control-h-*`), so a segmented
 * control beside a button of the same size matches in height, label size and
 * radius. Segments run one padding step tighter than a button because the gap
 * between segments already reads as padding.
 *
 * The selected segment is a `background-2` fill with `foreground` text, never
 * an inverted one — inverting inside thin chrome puts a bright slab in the
 * toolbar. Labels are normal weight: medium is the structural-label tier.
 *
 * Never shrink a segment's font or padding locally to fit a context. If the
 * context needs something smaller, use a smaller size.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'sm',
  ariaLabel,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: SegmentedControlSize;
  ariaLabel?: string;
}) {
  const height = `var(--control-h-${size})`;
  const text = size === 'xs' ? 'text-tiny tracking-tiny' : 'text-body tracking-body';
  const iconSize = size === 'xs' ? 'size-icon-xs' : 'size-icon-sm';

  return (
    <div role="group" aria-label={ariaLabel} className="flex items-center gap-0.5">
      {options.map((option) => {
        const selected = option.value === value;
        const Icon = option.icon;
        const unavailable = option.disabledReason !== undefined;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            disabled={selected || unavailable}
            title={option.disabledReason}
            onClick={() => onChange(option.value)}
            style={{ minHeight: height }}
            className={cn(
              'flex cursor-pointer items-center gap-1 rounded-[var(--radius-sm)] border-none px-2 font-normal transition-colors duration-150 ease-out disabled:cursor-default',
              text,
              selected
                ? 'bg-surface-inset text-text'
                : 'bg-transparent text-text-muted hover:bg-surface-raised hover:text-text',
              // Unavailable is dimmer, not a different colour (design.md §11).
              unavailable && 'opacity-50'
            )}
          >
            {Icon && <Icon className={cn(iconSize, 'shrink-0')} />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
