/** Someone typing, as the socket names them. */
export interface TypingPerson {
  userId: string;
  email: string;
}

/** Who a roster says someone is: the People list's row for them. */
export interface RosterName {
  user_id: string;
  name: string | null;
}

/**
 * The line above the composer: people named the way the People list names
 * them. The email's local part stands in only for someone the roster has no
 * name for (no name on the account, or not in the roster yet).
 */
export function describeTypingLine(
  typing: readonly TypingPerson[],
  roster: readonly RosterName[]
): string | null {
  if (typing.length === 0) return null;
  const names = typing.map(
    (person) => roster.find((r) => r.user_id === person.userId)?.name ?? person.email.split('@')[0]
  );
  if (names.length === 1) return `${names[0]} is typing...`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing...`;
  return `${names[0]} and ${names.length - 1} others are typing...`;
}
