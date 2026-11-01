import { memo, type ReactNode } from 'react';

interface StateCardProps {
  badge: string;
  tone?: 'neutral' | 'error';
  title: string;
  description: string;
  action?: ReactNode;
}

/**
 * Terminal-state surface for work-item resolution and room lifecycle states
 * (not found, no access, revoked, signed out, error). Mirrors the
 * discriminated share-state cards in kanwas' PublicDocumentSharePage.
 */
export const StateCard = memo(function StateCard({
  badge,
  tone = 'neutral',
  title,
  description,
  action,
}: StateCardProps) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-surface">
      <div className="flex w-full max-w-[400px] flex-col items-center gap-3 rounded-lg border border-border-subtle bg-surface-raised px-8 py-10 text-center">
        <span
          className={`rounded-full border px-3 py-1 text-tiny tracking-tiny font-semibold ${
            tone === 'error'
              ? 'border-border bg-status-err-bg text-status-err'
              : 'border-border bg-surface-inset text-text-muted'
          }`}
        >
          {badge}
        </span>
        <h2 className="text-title tracking-title font-semibold text-text">{title}</h2>
        <p className="text-body tracking-body leading-relaxed text-text-passive">{description}</p>
        {action}
      </div>
    </div>
  );
});
