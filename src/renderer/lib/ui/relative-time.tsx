import React, { useEffect, useMemo, useState } from 'react';
import { relativeTimeLabel } from './relative-time-label';

type RelativeTimeProps = {
  value: string | number | Date;
  className?: string;
  /** Renders an abbreviated form (e.g. "3d", "5mo") with a tooltip showing the full text. */
  compact?: boolean;
  /** Adds " ago" to the compact form; the full form always says it ("5 minutes ago"). */
  ago?: boolean;
};

function parseTimestamp(input: string | number | Date): Date | null {
  if (input instanceof Date) return input;
  if (typeof input === 'number') {
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const raw = String(input).trim();
  if (!raw) return null;

  const normalized = raw.includes('Z') || raw.includes('+') ? raw : raw.replace(' ', 'T') + 'Z';

  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const RelativeTime: React.FC<RelativeTimeProps> = ({ value, className, compact, ago }) => {
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  const date = useMemo(() => parseTimestamp(value), [value]);
  if (!date) {
    return <span className={className}>—</span>;
  }

  const label = relativeTimeLabel(date, { compact, ago });
  return (
    <time className={className} dateTime={date.toISOString()}>
      {label.value}
      {label.suffix && <span className="text-text-muted">{label.suffix}</span>}
    </time>
  );
};
