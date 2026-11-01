import { inArray } from 'drizzle-orm';
import { DEFAULT_REMOTE_NAME } from '@shared/git-utils';
import { normalizeRemoteUrl } from '@shared/repo-remote-url';
import { getRemoteUrl } from '@main/core/issues/git-remote-resolver';
import { db } from '@main/db/client';
import { repos } from '@main/db/schema-work-items';

/**
 * A repo's origin in the normalized form the cloud stores and a teammate's app
 * matches on (`@shared/repo-remote-url`). `null` when the repo names no shared
 * remote: no origin, a local-path origin, or a folder git can no longer read
 * (moved or deleted), the same reading repo-icon detection gives it.
 */
export async function readRepoOrigin(repoPath: string): Promise<string | null> {
  let remoteUrl: string;
  try {
    remoteUrl = await getRemoteUrl(repoPath, DEFAULT_REMOTE_NAME);
  } catch {
    return null;
  }
  return normalizeRemoteUrl(remoteUrl);
}

/** Every local repo's normalized origin, archived ones included. */
export async function listRepoOrigins(): Promise<
  { repoId: string; alias: string; remoteUrl: string | null }[]
> {
  const rows = await db
    .select({ id: repos.id, alias: repos.alias, path: repos.path })
    .from(repos)
    .orderBy(repos.alias);
  return Promise.all(
    rows.map(async (row) => ({
      repoId: row.id,
      alias: row.alias,
      remoteUrl: await readRepoOrigin(row.path),
    }))
  );
}

/** The normalized origin of each of these repos, by id; one query, one git call per repo. */
export async function readRepoOriginsById(
  repoIds: readonly string[]
): Promise<Map<string, string | null>> {
  const unique = [...new Set(repoIds)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ id: repos.id, path: repos.path })
    .from(repos)
    .where(inArray(repos.id, unique));
  const entries = await Promise.all(
    rows.map(async (row) => [row.id, await readRepoOrigin(row.path)] as const)
  );
  return new Map(entries);
}

/** A work item's origin out of `readRepoOriginsById`: none for an item with no repo. */
export function originOf(
  origins: ReadonlyMap<string, string | null>,
  repoId: string | null
): string | null {
  return repoId === null ? null : (origins.get(repoId) ?? null);
}
