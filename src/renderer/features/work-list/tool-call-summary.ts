import type { ToolCallBlockData, ToolCallKind } from './chat-types';

/** Singular/plural pair for each kind, phrased as the verb the agent performed. */
const PHRASES: Record<ToolCallKind, [string, string]> = {
  execute: ['Ran %n command', 'Ran %n commands'],
  edit: ['edited %n file', 'edited %n files'],
  read: ['read %n file', 'read %n files'],
  search: ['%n search', '%n searches'],
  fetch: ['%n fetch', '%n fetches'],
  unknown: ['%n tool call', '%n tool calls'],
};

/** Kinds read in this order so the sentence always opens with what was *done*. */
const ORDER: ToolCallKind[] = ['execute', 'edit', 'read', 'search', 'fetch', 'unknown'];

/**
 * Names a collapsed run of tool calls: "Ran 8 commands · edited 1 file · read
 * 5 files · 1 failed".
 *
 * A row of anonymous icons says an agent did six things; it does not say what.
 * The failure count is last and always present when non-zero — a failed call
 * inside a collapsed group is the one thing worth opening the group for.
 */
export function summarizeToolCalls(calls: readonly ToolCallBlockData[]): string {
  const counts = new Map<ToolCallKind, number>();
  let failed = 0;

  for (const call of calls) {
    counts.set(call.kind, (counts.get(call.kind) ?? 0) + 1);
    if (call.status === 'failed') failed += 1;
  }

  const parts = ORDER.filter((kind) => counts.has(kind)).map((kind) => {
    const n = counts.get(kind)!;
    const [one, many] = PHRASES[kind];
    return (n === 1 ? one : many).replace('%n', String(n));
  });

  if (failed > 0) parts.push(`${failed} failed`);
  return parts.join(' · ');
}
