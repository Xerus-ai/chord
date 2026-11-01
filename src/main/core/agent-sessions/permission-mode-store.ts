/**
 * The composer's permission mode, per agent session with a work-item-wide
 * fallback: the provider's own mode id (`PermissionModeOption.id`), or null
 * for the agent's default. In-memory on purpose: the mode is a
 * per-conversation stance ("plan the next thing I say"), not durable
 * work-item configuration — a fresh app start should always begin in the
 * default, never trap a session in plan mode.
 *
 * Live sessions are switched immediately (`applyLivePermissionMode`); this
 * store makes the choice survive the lazy session start (picked before the
 * first message) and session respawns. Each entry also keeps the mode it
 * replaced, so an approved plan returns the session to where it was.
 *
 * Resolution for a session: its own value, else the work item's value, else
 * null. A work-item-wide set clears every session override of that work
 * item, so "all sessions" really means all of them.
 */
export type ChatPermissionMode = string | null;

interface ModeEntry {
  mode: ChatPermissionMode;
  previous: ChatPermissionMode;
}

const modeByWorkItem = new Map<string, ModeEntry>();
const modeBySession = new Map<string, ModeEntry & { workItemId: string }>();

function readEntry(workItemId: string, sessionId?: string): ModeEntry | undefined {
  const own = sessionId === undefined ? undefined : modeBySession.get(sessionId);
  return (own?.workItemId === workItemId ? own : undefined) ?? modeByWorkItem.get(workItemId);
}

export function getChatPermissionMode(workItemId: string, sessionId?: string): ChatPermissionMode {
  return readEntry(workItemId, sessionId)?.mode ?? null;
}

/** The mode the current one replaced — where leaving plan mode returns to. */
export function getPreviousChatPermissionMode(
  workItemId: string,
  sessionId?: string
): ChatPermissionMode {
  return readEntry(workItemId, sessionId)?.previous ?? null;
}

export function setChatPermissionMode(
  workItemId: string,
  mode: ChatPermissionMode,
  sessionId?: string
): void {
  const current = readEntry(workItemId, sessionId);
  const entry: ModeEntry =
    current && current.mode === mode ? current : { mode, previous: current?.mode ?? null };
  if (sessionId !== undefined) {
    // Stored explicitly even for null so it overrides a work-item mode.
    modeBySession.set(sessionId, { workItemId, ...entry });
    return;
  }
  for (const [id, sessionEntry] of modeBySession) {
    if (sessionEntry.workItemId === workItemId) modeBySession.delete(id);
  }
  modeByWorkItem.set(workItemId, entry);
}
