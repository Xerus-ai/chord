import type { NeedsYouReason } from '@shared/sidebar-summaries';

/**
 * Pure selection logic for a work item's local `needsYou` reasons. Inputs are
 * read in sidebar-summaries.ts and needs-you-mention-reads.ts so this stays
 * testable without a DB. Review reasons are merged renderer-side
 * (`app-sidebar/needs-you-pull-request-reasons.ts`).
 */

export interface NeedsYouInput {
  pendingPermissionCount: number;
  pendingPlanCount: number;
  mentionCount: number;
}

export function buildNeedsYouReasons(input: NeedsYouInput): NeedsYouReason[] {
  const reasons: NeedsYouReason[] = [];
  if (input.pendingPermissionCount > 0) {
    reasons.push({ kind: 'pending_permission', count: input.pendingPermissionCount });
  }
  if (input.pendingPlanCount > 0) {
    reasons.push({ kind: 'pending_plan', count: input.pendingPlanCount });
  }
  if (input.mentionCount > 0) {
    reasons.push({ kind: 'mentioned', count: input.mentionCount });
  }
  return reasons;
}

/** Who "me" is for mention matching — the signed-in Chord account. */
export interface MentionIdentity {
  userId: string;
  /** Display name — the form the mention menu inserts. */
  username: string;
  email: string;
}

export interface MentionCandidateMessage {
  senderId: string | null;
  content: string;
  /** Epoch seconds. */
  createdAt: number;
}

// Token boundaries mirror renderer `chat-routing.ts` `findMentions`: a token
// counts at the start or after whitespace, and not when a character that
// would continue it follows ("@Ana" is not read out of "@Ana-Marie").
const NAME_TAIL = /[\w'-]/;
const EMAIL_TAIL = /[\w@.+-]/;

function containsToken(content: string, token: string, tail: RegExp): boolean {
  const lower = content.toLowerCase();
  const needle = `@${token.toLowerCase()}`;
  let from = lower.indexOf(needle);
  while (from !== -1) {
    const before = from === 0 ? undefined : content[from - 1];
    const after = content[from + needle.length];
    if ((before === undefined || /\s/.test(before)) && (after === undefined || !tail.test(after))) {
      return true;
    }
    from = lower.indexOf(needle, from + 1);
  }
  return false;
}

/** Whether a message addresses `me` by display name, email, or `@everyone`. */
export function mentionsUser(content: string, me: MentionIdentity): boolean {
  const name = me.username.trim();
  return (
    containsToken(content, 'everyone', NAME_TAIL) ||
    containsToken(content, me.email, EMAIL_TAIL) ||
    (name.length > 0 && containsToken(content, name, NAME_TAIL))
  );
}

/**
 * Messages that mention `me`, written by someone else, after the moment the
 * user last opened the item. A null sender is a row written while signed out
 * on this device — never a teammate — so it never counts. With no
 * `lastViewedAt` the item was never opened and every mention is unseen.
 */
export function countUnseenMentions(
  messages: readonly MentionCandidateMessage[],
  me: MentionIdentity,
  lastViewedAt: number | undefined
): number {
  let count = 0;
  for (const message of messages) {
    if (message.senderId === null || message.senderId === me.userId) continue;
    if (message.createdAt <= (lastViewedAt ?? 0)) continue;
    if (mentionsUser(message.content, me)) count += 1;
  }
  return count;
}
