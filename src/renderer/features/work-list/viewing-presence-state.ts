import type { PresenceUpdateEvent } from '@chord/protocol';
import { artifactPresenceFile } from '@renderer/features/artifacts/artifact-presence';
import type { CenterTab } from './center-tab';

/**
 * What one view advertises on its presence row: the focused tab. `file` is
 * what a ring means ("viewing this"): an artifact's surface key, a repo path,
 * or a chat session. `view` is read by people ("In chat" on the team pulse).
 */
export interface PresenceState {
  file: string | null;
  view: 'artifact' | 'file' | 'chat' | 'work item';
}

/** A session's kind ('chat' or 'terminal'), or undefined for a session this view does not know. */
export type SessionKindOf = (sessionId: string) => string | undefined;

const NOTHING_VIEWED: PresenceState = { file: null, view: 'work item' };

/** The presence `file` of a chat session: being in its tab counts as viewing it. */
export function chatPresenceFile(sessionId: string): string {
  return `session:${sessionId}`;
}

/** The Work item chat's presence `file`: a chat, though it holds no session. */
const ITEM_CHAT_PRESENCE_FILE = chatPresenceFile('work-item-chat');

/**
 * The focused tab's presence. A terminal is local to its owner and a commit
 * is history, so neither is advertised.
 */
export function presenceStateOf(
  tab: CenterTab | null | undefined,
  sessionKindOf: SessionKindOf
): PresenceState {
  if (!tab) return NOTHING_VIEWED;
  switch (tab.kind) {
    case 'path':
      if (tab.artifactId !== undefined) {
        return { file: artifactPresenceFile(tab.artifactId), view: 'artifact' };
      }
      return tab.filePath === undefined ? NOTHING_VIEWED : { file: tab.filePath, view: 'file' };
    case 'item-chat':
      return { file: ITEM_CHAT_PRESENCE_FILE, view: 'chat' };
    case 'session':
      return sessionKindOf(tab.sessionId) === 'chat'
        ? { file: chatPresenceFile(tab.sessionId), view: 'chat' }
        : NOTHING_VIEWED;
    case 'commit':
      return NOTHING_VIEWED;
  }
}

/**
 * The `presence_update` payload. With nothing viewed the cursor is omitted,
 * which the server stores as null: the previous file does not linger.
 */
export function presencePayload(
  workItemId: string,
  state: PresenceState
): PresenceUpdateEvent['payload'] {
  return state.file === null
    ? { work_item_id: workItemId, status: 'online', active_view: state.view }
    : {
        work_item_id: workItemId,
        status: 'online',
        cursor_position: { file: state.file },
        active_view: state.view,
      };
}
