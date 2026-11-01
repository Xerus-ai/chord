/**
 * What the composer says in its box: why it can't send, when it can't (user
 * decision 2026-10-01: a blocked composer looks like any other, the reason
 * inside it), else who a message reaches.
 */
export function composerPlaceholder({
  blockedReason,
  agentBlockedReason,
  agentControls,
}: {
  blockedReason: string | null;
  agentBlockedReason: string | null;
  /** The owner's composer, with the agent's own controls. */
  agentControls: boolean;
}): string {
  if (blockedReason) return blockedReason;
  if (agentControls) return 'Message the agent, mention @people, +files, or use / for commands';
  return agentBlockedReason
    ? 'Message the thread, or mention @people…'
    : 'Message the thread, or @agent to prompt it…';
}

/** The line under the composer: an error first, else a notice. The blocked reason is in the box. */
export function composerHint({
  error,
  notice,
}: {
  error: string | null;
  notice: string | null;
}): string | null {
  return error ?? notice;
}
