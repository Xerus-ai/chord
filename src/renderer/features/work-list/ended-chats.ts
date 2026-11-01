/** A session as the owner's `+` lists it. */
interface EndedChatSource {
  id: string;
  kind: string;
  status: string;
  lastActiveAt: number;
}

/**
 * The owner's ended chats, for the `+` menu's Ended section (shared-items step
 * 5, decision 5): the most recently active first, since the chat just closed
 * is the one most likely wanted back. Terminals have no transcript to reopen.
 */
export function listEndedChats<T extends EndedChatSource>(sessions: readonly T[]): T[] {
  return sessions
    .filter((s) => s.kind === 'chat' && s.status === 'done')
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}
