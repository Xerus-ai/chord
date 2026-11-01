import type { TranscriptItem } from './transcript-rows';

/**
 * What a Reset dropped from an agent's memory, read off the transcript: each
 * `history_reset` row names the turn it went back to, and the same session's
 * prompts and turns between that turn and the row are no longer remembered.
 * Nothing is deleted (the chat is shared), so they render dimmed instead.
 */

export interface ForgottenRow {
  /** The agent that forgot it: the reset's target turn's agent. */
  agentName: string;
  /** The first row of a dimmed run, which carries the caption. */
  startsRun: boolean;
}

function sessionOf(item: TranscriptItem): string | undefined {
  if (item.type === 'turn') return item.turn.sessionId;
  if (item.type === 'message') return item.entry.sessionId;
  return undefined;
}

function resetTargetOf(item: TranscriptItem): string | null {
  if (item.type !== 'message' || item.entry.kind !== 'system-event') return null;
  return item.entry.event?.type === 'history_reset' ? item.entry.event.targetTurnId : null;
}

/** The rows, by index into `items`, that a reset dropped from their agent's memory. */
export function findForgottenRows(
  items: readonly TranscriptItem[]
): ReadonlyMap<number, ForgottenRow> {
  const forgotten = new Map<number, string>();
  items.forEach((item, resetIndex) => {
    const targetTurnId = resetTargetOf(item);
    if (targetTurnId === null) return;
    const sessionId = sessionOf(item);
    const targetIndex = items.findIndex(
      (candidate, index) =>
        index < resetIndex && candidate.type === 'turn' && candidate.turn.id === targetTurnId
    );
    if (targetIndex === -1) return;
    const target = items[targetIndex];
    const agentName = target.type === 'turn' ? target.turn.agentName : '';
    for (let index = targetIndex + 1; index < resetIndex; index++) {
      const row = items[index];
      if (row.type !== 'divider' && resetTargetOf(row) === null && sessionOf(row) === sessionId) {
        forgotten.set(index, agentName);
      }
    }
  });

  const rows = new Map<number, ForgottenRow>();
  for (const index of [...forgotten.keys()].sort((a, b) => a - b)) {
    rows.set(index, {
      agentName: forgotten.get(index) as string,
      startsRun: !forgotten.has(index - 1),
    });
  }
  return rows;
}

/**
 * For every turn, how many of its session's later turns the agent still
 * remembers: what a Reset to it drops. One pass from the end.
 */
export function countRememberedLaterTurns(
  items: readonly TranscriptItem[]
): ReadonlyMap<string, number> {
  const forgotten = findForgottenRows(items);
  const rememberedAfter = new Map<string | undefined, number>();
  const counts = new Map<string, number>();
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    if (item.type !== 'turn') continue;
    const sessionId = item.turn.sessionId;
    const seen = rememberedAfter.get(sessionId) ?? 0;
    counts.set(item.turn.id, seen);
    if (!forgotten.has(index)) rememberedAfter.set(sessionId, seen + 1);
  }
  return counts;
}

/** How many of the session's turns after `turnId` the agent still remembers. */
export function countRememberedTurnsAfter(
  items: readonly TranscriptItem[],
  turnId: string
): number {
  return countRememberedLaterTurns(items).get(turnId) ?? 0;
}
