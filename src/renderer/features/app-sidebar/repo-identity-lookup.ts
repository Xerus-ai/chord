import type { RepoIcon } from '@shared/repo-icons';

/** What a repo group header knows about the repo behind it. */
export interface RepoIdentity {
  icon: RepoIcon | null;
  /**
   * Whether the group key is a row in the local `repos` table. A teammate's
   * shared item groups under its cloud `repo_name` and an item with no repo
   * groups under `'no-repo'` — neither has a local row, so neither can be
   * given an icon, a new work item, or the repo menu.
   */
  isLocal: boolean;
}

const NOT_LOCAL: RepoIdentity = { icon: null, isLocal: false };

export type RepoIdentityLookup = ReadonlyMap<string, RepoIcon | null>;

/**
 * Indexes the local repo rows by id. The icons arrive already validated — the
 * repos controller parses the column and refuses a value it cannot read — so
 * this only has to carry the union through, including the difference between
 * `{ type: 'letter' }` (settled) and `null` (never probed).
 */
export function buildRepoIdentityLookup(
  repoRows: readonly { id: string; icon: RepoIcon | null }[]
): RepoIdentityLookup {
  const byId = new Map<string, RepoIcon | null>();
  for (const row of repoRows) {
    byId.set(row.id, row.icon);
  }
  return byId;
}

export function resolveRepoIdentity(lookup: RepoIdentityLookup, groupKey: string): RepoIdentity {
  if (!lookup.has(groupKey)) return NOT_LOCAL;
  return { icon: lookup.get(groupKey) ?? null, isLocal: true };
}
