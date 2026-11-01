/**
 * What the People section shows under its header: the rows, a loading line,
 * the failure alone, or that nobody has access. A roster still loading is not
 * an empty one (devstation-nyw), and a failed refetch keeps the roster it had.
 */
export type RosterBody = 'rows' | 'loading' | 'error' | 'empty';

export function rosterBody(
  query: { isPending: boolean; error: unknown },
  count: number
): RosterBody {
  if (count > 0) return 'rows';
  if (query.isPending) return 'loading';
  if (query.error) return 'error';
  return 'empty';
}
