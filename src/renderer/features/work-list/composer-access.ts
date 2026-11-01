import type { RoomJoinStatus } from '@renderer/lib/sync/room-registry';
import type { MentionKind } from './mention-menu';
import type { WorkItemCapabilities } from './work-item-access';

/**
 * Why a viewer's write controls are inert. The server refuses every chat
 * write from a viewer (authorizeWorkItemWrite), so the composer says so up
 * front rather than accepting text the room will never see.
 */
export const READ_ONLY_REASON =
  'Read-only access — ask the owner for edit access to post messages.';

/**
 * Why addressing the agent is inert under approval_policy='owner' (the
 * default). The server refuses EVERY command kind from a non-owner until the
 * owner opts in (server/src/routes/commands.ts), so the composer says so up
 * front instead of POSTing into a 403. Also the copy a cloud chat thread shows
 * when a 403 does come back — the policy can flip between render and POST.
 */
export const AGENT_ACCESS_REASON = 'The owner hasn’t enabled agent access for participants.';

/**
 * Why an ended chat takes no message (shared-items step 5, decision 5), for the
 * owner and the teammate alike. It names no next step: a teammate cannot start
 * a chat, and the owner's `+` is where a new one starts.
 */
export const ENDED_CHAT_REASON = 'This chat has ended.';

/** How the composer reaches the thread: the owner's is local; a teammate's is the room. */
export type ComposerConnection = 'local' | RoomJoinStatus | null;

export interface ComposerAccess {
  /** Why nothing can be sent; null while the composer is open. */
  blockedReason: string | null;
  /** Why the agent cannot be addressed, while the thread still can. */
  agentBlockedReason: string | null;
  /** Worth knowing, but not a block. */
  notice: string | null;
  /**
   * The chat has ended: the composer shows itself closed — no pickers, no +,
   * no send — not live-looking controls under a line saying they are inert
   * (devstation-9yc).
   */
  ended: boolean;
}

/**
 * One answer, for both viewers, to what the composer lets through (step 4,
 * S5c). An ended chat is closed to everyone, so it comes first; then the role
 * reason: a viewer lacks every write, and the role is the reason they can act
 * on.
 */
export function resolveComposerAccess({
  capabilities,
  connection,
  deviceOnline,
  ended = false,
}: {
  capabilities: Pick<WorkItemCapabilities, 'chat' | 'promptAgent'>;
  connection: ComposerConnection;
  /** Whether the owner's device is online to run what the agent is sent. */
  deviceOnline: boolean;
  /** The chat has ended (its session is done). */
  ended?: boolean;
}): ComposerAccess {
  if (capabilities.chat === 'none') {
    throw new Error('A viewer without chat has no composer');
  }
  if (ended) {
    return {
      blockedReason: ENDED_CHAT_REASON,
      agentBlockedReason: null,
      notice: null,
      ended: true,
    };
  }
  const blockedReason =
    capabilities.chat === 'read'
      ? READ_ONLY_REASON
      : connection === 'local' || connection === 'joined'
        ? null
        : connection === 'joining'
          ? 'Connecting to the session — sending is disabled until the room is joined.'
          : 'Not connected to the session — sending is disabled.';
  return {
    blockedReason,
    agentBlockedReason: capabilities.promptAgent ? null : AGENT_ACCESS_REASON,
    notice:
      capabilities.promptAgent && !deviceOnline
        ? "The owner's device is offline — prompts to the agent wait until it is back."
        : null,
    ended: false,
  };
}

const ALL_MENTION_KINDS: ReadonlySet<MentionKind> = new Set(['people', 'work-items', 'files']);
const REMOTE_MENTION_KINDS: ReadonlySet<MentionKind> = new Set(['people', 'work-items']);

/** What `@`, `#` and `+` can open: files come from the checkout, which only the owner has. */
export function mentionKindsFor(
  capabilities: Pick<WorkItemCapabilities, 'files'>
): ReadonlySet<MentionKind> {
  return capabilities.files ? ALL_MENTION_KINDS : REMOTE_MENTION_KINDS;
}
