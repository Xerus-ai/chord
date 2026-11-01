import { AlertTriangle, CheckCircle2, Loader2, Radio } from 'lucide-react';
import { useMemo } from 'react';
import type { TimelineCursor } from '@shared/session-stream-reducers';
import type { AgentTurn } from '@shared/stream-items';

interface SessionTimelineProps {
  turns: AgentTurn[];
  cursor: TimelineCursor | undefined;
  isCatchingUp: boolean;
  onTurnClick?: (turnId: string) => void;
}

function formatTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function turnSummary(turn: AgentTurn): string {
  const toolCount = turn.items.filter((i) => i.kind === 'tool_group').length;
  const textCount = turn.items.filter((i) => i.kind === 'text').length;
  const parts: string[] = [];
  if (textCount > 0) parts.push(`${textCount} message${textCount > 1 ? 's' : ''}`);
  if (toolCount > 0) parts.push(`${toolCount} tool${toolCount > 1 ? 's' : ''}`);
  return parts.join(', ') || `${turn.items.length} item${turn.items.length !== 1 ? 's' : ''}`;
}

function TurnStatusIcon({ status }: { status: AgentTurn['status'] }) {
  if (status === 'streaming') {
    return <Radio className="h-3.5 w-3.5 animate-pulse text-text" />;
  }
  return <CheckCircle2 className="h-3.5 w-3.5 text-text-passive" />;
}

function CatchUpBanner() {
  return (
    <div className="flex items-center gap-2 rounded-md border border-status-warn/20 bg-status-warn/[0.06] px-3 py-2">
      <Loader2 className="h-3.5 w-3.5 animate-spin text-status-warn" />
      <span className="text-tiny tracking-tiny font-medium text-status-warn">
        Catching up on missed events...
      </span>
    </div>
  );
}

function GapMarker() {
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="h-px flex-1 bg-status-warn/30" />
      <AlertTriangle className="h-3 w-3 text-status-warn/60" />
      <span className="text-micro tracking-micro text-status-warn/60">gap detected</span>
      <div className="h-px flex-1 bg-status-warn/30" />
    </div>
  );
}

function CursorIndicator({ cursor }: { cursor: TimelineCursor }) {
  return (
    <div className="flex items-center gap-1 text-micro tracking-micro font-mono text-text-passive">
      <span className="rounded bg-surface-hover-solid px-1.5 py-0.5">seq {cursor.endSeq}</span>
      <span className="truncate max-w-[80px] opacity-60" title={cursor.epoch}>
        {cursor.epoch.slice(0, 8)}
      </span>
    </div>
  );
}

export function SessionTimeline({
  turns,
  cursor,
  isCatchingUp,
  onTurnClick,
}: SessionTimelineProps) {
  const sortedTurns = useMemo(() => [...turns].sort((a, b) => a.timestamp - b.timestamp), [turns]);

  if (sortedTurns.length === 0 && !isCatchingUp) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-text-passive">
        <span className="text-tiny tracking-tiny">No session history yet</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 py-2">
      <div className="flex items-center justify-between px-3 pb-1.5">
        <span className="text-tiny tracking-tiny font-semibold uppercase tracking-wider text-text-muted">
          Session Timeline
        </span>
        {cursor && <CursorIndicator cursor={cursor} />}
      </div>

      {isCatchingUp && <CatchUpBanner />}

      <div className="relative flex flex-col">
        <div className="absolute left-[19px] top-2 bottom-2 w-px bg-border" />

        {sortedTurns.map((turn, idx) => {
          const prevTurn = idx > 0 ? sortedTurns[idx - 1] : null;
          const hasGap = prevTurn && turn.timestamp - prevTurn.timestamp > 300;

          return (
            <div key={turn.id}>
              {hasGap && <GapMarker />}
              <button
                type="button"
                onClick={() => onTurnClick?.(turn.id)}
                className="group flex w-full items-start gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-surface-hover"
              >
                <div className="relative z-10 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-inset">
                  <TurnStatusIcon status={turn.status} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-tiny tracking-tiny font-medium text-text">
                      {turn.agentName}
                    </span>
                    <span className="shrink-0 text-tiny tracking-tiny text-text-passive">
                      {formatTime(turn.timestamp)}
                    </span>
                  </div>
                  <span className="text-tiny tracking-tiny text-text-muted">
                    {turnSummary(turn)}
                  </span>
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
