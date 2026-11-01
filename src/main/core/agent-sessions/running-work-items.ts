import type { ActiveSession } from '@main/core/work-items/active-sessions';

/**
 * Work items that currently own a live agent conversation.
 *
 * Only `chat` sessions count: a terminal session is an interactive shell the
 * user drives, not an agent the work item is waiting on, so counting it would
 * badge rows "Running" for as long as a terminal tab stays open.
 *
 * Ids are returned in first-seen order and de-duplicated — a work item with
 * several live chat sessions is one running work item.
 */
export function selectRunningWorkItemIds(sessions: Iterable<ActiveSession>): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const session of sessions) {
    if (session.kind !== 'chat') continue;
    if (seen.has(session.workItemId)) continue;
    seen.add(session.workItemId);
    ids.push(session.workItemId);
  }
  return ids;
}
