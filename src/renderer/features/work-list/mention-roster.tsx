import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { PluggableList } from 'unified';
import type { RoutableParticipant } from './chat-routing';
import { createMentionPillPlugin } from './mention-pill-rehype';

/**
 * The rendered transcript needs the roster to know where a `@Display Name`
 * token ends, but a message row must not fetch it — there are hundreds of rows
 * and one roster. The chat surface that already loads the participants scopes
 * it down here instead.
 *
 * The context carries the finished plugin list rather than the participants:
 * one identity shared by every row, which is what lets `MarkdownRenderer` stay
 * memoized until the roster actually changes.
 */
const MentionPillContext = createContext<PluggableList | null>(null);

export function MentionRosterProvider({
  participants,
  children,
}: {
  participants: readonly RoutableParticipant[];
  children: ReactNode;
}) {
  const plugins = useMemo<PluggableList>(
    () => [createMentionPillPlugin(participants)],
    [participants]
  );
  return <MentionPillContext.Provider value={plugins}>{children}</MentionPillContext.Provider>;
}

/** Rehype plugins that turn mentions into pills. Requires a surrounding provider. */
export function useMentionPillPlugins(): PluggableList {
  const plugins = useContext(MentionPillContext);
  if (!plugins) {
    throw new Error('useMentionPillPlugins requires a MentionRosterProvider above it');
  }
  return plugins;
}
