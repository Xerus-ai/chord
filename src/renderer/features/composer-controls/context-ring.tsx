import { type AgentProviderId } from '@shared/agent-provider-registry';
import { getProvider } from '@shared/agent-providers';
import { contextFill, formatTokenCount, type ContextTone } from '@shared/session-telemetry';
import type { UsageWindow } from '@shared/usage-window';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { useProviderUsage, useSessionTelemetry } from './use-session-telemetry';

const TONE_CLASS: Record<ContextTone, string> = {
  normal: 'text-text-muted',
  warning: 'text-status-warn',
  danger: 'text-status-err',
};

const RADIUS = 7;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function Ring({ percent, tone }: { percent: number; tone: ContextTone }) {
  return (
    <svg viewBox="0 0 18 18" className={`size-[18px] -rotate-90 ${TONE_CLASS[tone]}`}>
      <circle cx="9" cy="9" r={RADIUS} fill="none" strokeWidth="2" className="stroke-border" />
      <circle
        cx="9"
        cy="9"
        r={RADIUS}
        fill="none"
        strokeWidth="2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={CIRCUMFERENCE * (1 - percent / 100)}
      />
    </svg>
  );
}

function formatResetTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function WindowRow({ usage: w }: { usage: UsageWindow }) {
  const tone: ContextTone =
    w.usedPercent > 90 ? 'danger' : w.usedPercent >= 70 ? 'warning' : 'normal';
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-tiny tracking-tiny">
        <span className="text-text-muted">{w.label}</span>
        <span className="text-text tabular-nums">{100 - w.usedPercent}% left</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-surface-hover-solid">
        <div
          className={`h-full rounded-full bg-current ${TONE_CLASS[tone]}`}
          style={{ width: `${w.usedPercent}%` }}
        />
      </div>
      {w.resetsAt !== null && (
        <span className="text-micro tracking-micro text-text-passive">
          Resets {formatResetTime(w.resetsAt)}
        </span>
      )}
    </div>
  );
}

/**
 * How full the session's context window is, as a ring beside Send; its popover
 * adds the session's cost and the provider's plan usage windows. Shown once
 * there is something real to show — the session's context, or the provider's
 * windows, which can be known before the first turn (Codex) — so a provider
 * that never reports gets no ring rather than a permanently empty one.
 */
export function ContextRing({
  sessionId,
  providerId,
}: {
  sessionId: string;
  providerId: AgentProviderId;
}) {
  const telemetry = useSessionTelemetry(sessionId);
  const { usage, refresh } = useProviderUsage(providerId);
  const context = telemetry?.context ?? null;
  const windows = usage?.windows ?? [];
  if (!context && windows.length === 0) return null;

  const fill = context ? contextFill(context) : null;
  const providerName = getProvider(providerId)?.name ?? providerId;

  return (
    <Popover onOpenChange={(open) => open && refresh()}>
      <PopoverTrigger
        aria-label={fill ? `Context ${fill.percent}% used` : `${providerName} usage`}
        className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent hover:bg-surface-hover"
      >
        <Ring percent={fill?.percent ?? 0} tone={fill?.tone ?? 'normal'} />
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-72 gap-3">
        {context && fill && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-body tracking-body text-text">Context window</span>
              <span className={`text-tiny tracking-tiny tabular-nums ${TONE_CLASS[fill.tone]}`}>
                {fill.percent}% used
              </span>
            </div>
            <span className="text-tiny tracking-tiny text-text-muted tabular-nums">
              {formatTokenCount(context.usedTokens)} / {formatTokenCount(context.maxTokens)} tokens
            </span>
            {telemetry?.costUsd != null && (
              <span className="text-tiny tracking-tiny text-text-muted tabular-nums">
                Session cost ${telemetry.costUsd.toFixed(2)}
              </span>
            )}
          </div>
        )}
        {windows.length > 0 && (
          <div className="flex flex-col gap-3 border-t border-border-subtle pt-3">
            <span className="text-body tracking-body text-text">{providerName} usage</span>
            {windows.map((w) => (
              <WindowRow key={w.id} usage={w} />
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
