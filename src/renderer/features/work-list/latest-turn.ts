import type { AgentTurn } from '@shared/stream-items';

/**
 * The newest turn by timestamp — never by array position.
 *
 * Turns reach the renderer as a Map whose insertion order is the order rows
 * and stream events arrived, not chronology: the canonical seed
 * (`use-chat-messages.ts`) can put an in-flight turn ahead of older persisted
 * ones. Selecting `turns[turns.length - 1]` therefore points at an arbitrary
 * turn, which silently hides live permission prompts and pins auto-scroll to
 * the wrong item count.
 *
 * Equal timestamps keep the later array entry: turn timestamps are epoch
 * SECONDS, so two turns in the same second are common and insertion order is
 * the only remaining signal.
 */
export function selectLatestTurn(turns: readonly AgentTurn[]): AgentTurn | undefined {
  let latest: AgentTurn | undefined;
  for (const turn of turns) {
    if (!latest || turn.timestamp >= latest.timestamp) latest = turn;
  }
  return latest;
}
