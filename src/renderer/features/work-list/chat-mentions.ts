import type { MentionKind } from './mention-menu';

interface MentionTrigger {
  kind: MentionKind;
  /**
   * Whether the trigger alone opens the menu. `+` is arithmetic in ordinary
   * prose — typing "1 + 1" fired the file menu on the bare `+`, which then
   * swallowed the Enter meant to send the message. `@` and `#` carry no such
   * meaning mid-sentence, so they still open on the trigger alone.
   */
  requiresQuery: boolean;
}

const MENTION_TRIGGERS: Record<string, MentionTrigger> = {
  '@': { kind: 'people', requiresQuery: false },
  '#': { kind: 'work-items', requiresQuery: false },
  '+': { kind: 'files', requiresQuery: true },
};

/** An `@` token that has run into a second word — see `activeMentionAt`. */
const PEOPLE_TOKEN = /(^|\s)@([^\s]* [^\s]*)$/;

export interface ActiveMention {
  kind: MentionKind;
  /** Text typed after the trigger char */
  query: string;
  /** Index of the trigger char in the composer value */
  start: number;
}

/**
 * The mention token containing the caret: a run of non-whitespace starting
 * with @/#/+ at the start of the input or after whitespace. Null when the
 * caret isn't inside one — including a bare trigger that needs a query.
 *
 * Pure, and separate from the composer, so the trigger rules are testable
 * without mounting a component that reaches for Electron.
 */
export function activeMentionAt(
  value: string,
  caret: number,
  kinds?: ReadonlySet<MentionKind>
): ActiveMention | null {
  const upToCaret = value.slice(0, caret);
  const match = /(^|\s)([@#+])(\S*)$/.exec(upToCaret);
  if (match) {
    const trigger = MENTION_TRIGGERS[match[2]];
    if (!trigger || (kinds && !kinds.has(trigger.kind))) return null;
    const query = match[3];
    if (trigger.requiresQuery && query.length === 0) return null;
    return { kind: trigger.kind, query, start: caret - query.length - 1 };
  }

  // People are mentioned by display name now, and display names are "First
  // Last" — the menu has to keep filtering while the surname is typed. It
  // stops at the second word: past that the text is prose, nothing matches it,
  // and a menu with no matches renders nothing and leaves Enter alone.
  const people = PEOPLE_TOKEN.exec(upToCaret);
  if (!people) return null;
  const query = people[2];
  return { kind: 'people', query, start: caret - query.length - 1 };
}
