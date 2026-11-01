import { and, eq, inArray, isNotNull, like } from 'drizzle-orm';
import type { SidebarLastViewedAtSnapshot } from '@shared/view-state';
import { chordAccountService } from '@main/core/account/services/chord-account-service';
import { db } from '@main/db/client';
import { chatMessages } from '@main/db/schema-work-items';
import { countUnseenMentions, type MentionCandidateMessage } from './needs-you';

/**
 * Unseen mentions of the signed-in Chord user, per work item. "Seen" is the
 * persisted `sidebar.lastViewedAt` view-state the sidebar writes when the user
 * opens and leaves an item. Signed out there is no "me" to mention, so the
 * map is empty.
 */
export async function readUnseenMentionCounts(
  ids: string[],
  lastViewedAt: SidebarLastViewedAtSnapshot | null
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const { user } = await chordAccountService.getSession();
  if (!user) return counts;

  // Only human rows from someone with an identity, and only rows that
  // contain an `@` at all — the token check runs on the survivors.
  const rows = await db
    .select({
      workItemId: chatMessages.workItemId,
      senderId: chatMessages.senderId,
      content: chatMessages.content,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(
      and(
        inArray(chatMessages.workItemId, ids),
        eq(chatMessages.senderType, 'human'),
        isNotNull(chatMessages.senderId),
        like(chatMessages.content, '%@%')
      )
    );

  const byWorkItem = new Map<string, MentionCandidateMessage[]>();
  for (const row of rows) {
    byWorkItem.set(row.workItemId, [...(byWorkItem.get(row.workItemId) ?? []), row]);
  }
  for (const [workItemId, messages] of byWorkItem) {
    const count = countUnseenMentions(messages, user, lastViewedAt?.[workItemId]);
    if (count > 0) counts.set(workItemId, count);
  }
  return counts;
}
