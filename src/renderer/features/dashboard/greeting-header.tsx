import { useEffect, useState } from 'react';
import type { StatusSignal } from '@renderer/lib/status-dot';
import { cn } from '@renderer/utils/utils';
import type { StatSegment } from './dashboard-projection';

function getGreeting(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatTime(date: Date): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  const h = hours % 12 || 12;
  return `${days[date.getDay()]} ${h}:${minutes}${ampm}`;
}

/**
 * The current time, re-read on every minute boundary.
 *
 * Both the clock and the greeting used to be computed bare in render with
 * nothing to re-render them, so a window left open read "Good morning" at 6pm
 * and held whatever minute it mounted on. Scheduling to the next boundary
 * rather than a fixed 60s interval means the displayed minute changes when the
 * real one does instead of drifting by however long after :00 the app opened.
 */
export function useCurrentMinute(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;

    const scheduleNextTick = () => {
      const date = new Date();
      const msPastMinute = date.getSeconds() * 1000 + date.getMilliseconds();
      timeout = setTimeout(() => {
        setNow(new Date());
        scheduleNextTick();
      }, 60_000 - msPastMinute);
    };

    scheduleNextTick();
    return () => clearTimeout(timeout);
  }, []);

  return now;
}

/** A stat's number is tinted only where the count is a signal. */
const STAT_TONE: Partial<Record<StatusSignal, string>> = {
  warning: 'text-status-warn',
  running: 'text-status-running',
};

export function GreetingHeader({
  stats,
  userName,
}: {
  /** null while the counts are loading; empty when there is nothing to count. */
  stats: StatSegment[] | null;
  userName: string | null;
}) {
  const now = useCurrentMinute();
  const greeting = getGreeting(now);
  const time = formatTime(now);
  const name = userName ? `, ${userName}` : '';

  return (
    <div className="mb-7">
      <div className="animate-fade-up mb-2 font-mono text-tiny tracking-tiny text-text-passive">
        chord &middot; {time}
      </div>
      <h1
        className="animate-fade-up text-display tracking-display font-bold text-text"
        style={{ animationDelay: '60ms' }}
      >
        {greeting}
        {name}.
      </h1>
      <div className="animate-fade-up mt-2" style={{ animationDelay: '120ms' }}>
        {stats === null ? (
          <div className="h-4 w-64 animate-pulse rounded-sm bg-surface-hover" />
        ) : (
          stats.length > 0 && (
            <p className="text-body tracking-body text-text-passive">
              {stats.map((stat, index) => (
                <span key={stat.label}>
                  {index > 0 && <span className="mx-1.5 text-text-disabled">&middot;</span>}
                  <span
                    className={cn(
                      'font-medium tabular-nums',
                      STAT_TONE[stat.signal] ?? 'text-text-muted'
                    )}
                  >
                    {stat.count}
                  </span>{' '}
                  {stat.label}
                </span>
              ))}
            </p>
          )
        )}
      </div>
    </div>
  );
}
