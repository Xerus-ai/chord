/** How much of a name's end always shows: a lane's own slug, or a hash. */
const TAIL_LENGTH = 12;

/**
 * Splits a name for a middle ellipsis (`MiddleTruncate`): `head` takes the
 * ellipsis when the row is too narrow, `tail` always shows. Branch names of
 * one work item share their head and differ at their end, so the end is what
 * must survive. At most half the name is tail, so a short one still reads
 * from its start.
 */
export function splitMiddleTruncation(name: string): { head: string; tail: string } {
  const tailLength = Math.min(TAIL_LENGTH, Math.floor(name.length / 2));
  const cut = name.length - tailLength;
  return { head: name.slice(0, cut), tail: name.slice(cut) };
}
