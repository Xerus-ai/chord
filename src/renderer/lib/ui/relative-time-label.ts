import { formatDistanceStrict } from 'date-fns';

const MINUTE_MS = 60_000;

export interface RelativeTimeLabel {
  value: string;
  /** " ago" after a compact value, rendered quieter; null when `value` says it all. */
  suffix: string | null;
}

/**
 * What `RelativeTime` says. Under a minute is "just now" wherever it is read
 * as words — never "now ago" or "0 seconds ago" (devstation-2f3); the bare
 * compact form, a row's meta column, stays "now". Past a minute: "5m" /
 * "5m ago" compact, "5 minutes ago" in full.
 */
export function relativeTimeLabel(
  date: Date,
  { compact = false, ago = false }: { compact?: boolean; ago?: boolean },
  now: number = Date.now()
): RelativeTimeLabel {
  if (now - date.getTime() < MINUTE_MS) {
    return { value: compact && !ago ? 'now' : 'just now', suffix: null };
  }
  if (!compact) {
    return { value: formatDistanceStrict(date, now, { addSuffix: true }), suffix: null };
  }
  const short = formatDistanceStrict(date, now, { roundingMethod: 'floor' })
    .replace(/ seconds?/, 's')
    .replace(/ minutes?/, 'm')
    .replace(/ hours?/, 'h')
    .replace(/ days?/, 'd')
    .replace(/ months?/, 'mo')
    .replace(/ years?/, 'y');
  return { value: short, suffix: ago ? ' ago' : null };
}
