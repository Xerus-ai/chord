import type { ReactNode } from 'react';

interface CalloutProps {
  type?: 'info' | 'warning' | 'error' | 'success';
  title?: string;
  children: ReactNode;
}

const ICONS: Record<NonNullable<CalloutProps['type']>, string> = {
  info: 'ℹ',
  warning: '⚠',
  error: '✕',
  success: '✓',
};

/**
 * Styled by `components.css` through the `chord-callout` classes. The type is
 * a modifier class so the sheet decides which status token carries the hue.
 */
export function Callout({ type = 'info', title, children }: CalloutProps) {
  return (
    <div className={`chord-callout chord-callout-${type}`} role="note">
      <span className="chord-callout-icon" aria-hidden="true">
        {ICONS[type]}
      </span>
      <div className="chord-callout-body">
        {title && <div className="chord-callout-title">{title}</div>}
        <div className="chord-callout-text">{children}</div>
      </div>
    </div>
  );
}
