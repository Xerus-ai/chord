import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { JustMePatch, RepoJustMeSettings, TeamConfigPatch } from '@shared/repo-config';
import { db } from '@main/db/client';
import { repoSettings } from '@main/db/schema-repo-settings';
import { repos } from '@main/db/schema-work-items';
import { parseTeamConfig, TEAM_CONFIG_FILE } from './read-team-config';
import { readJustMeSettings, repoJustMeSettingsSchema } from './resolve-repo-config';
import { assertTeamFileOnBase } from './team-file-lineage';

/**
 * The repository page's two write paths (patch shapes: `@shared/repo-config`).
 * In both, `null` clears a value so the layer below applies again.
 *   - Just me: this machine's `repo_settings.overrides`.
 *   - Team: the main checkout's `.chord.json`, written and left uncommitted.
 *     Lanes read the file at their base ref, so a team edit applies once the
 *     user commits it and it reaches that ref — Chord never commits or pushes.
 */

/** Groups merged key by key, each dropped once empty. */
const NESTED_KEYS = new Set(['scripts', 'worktreeSources']);

function applyPatch(
  current: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (NESTED_KEYS.has(key)) {
      const group = applyPatch(
        (current[key] as Record<string, unknown> | undefined) ?? {},
        value as Record<string, unknown>
      );
      if (Object.keys(group).length > 0) next[key] = group;
      else delete next[key];
    } else if (value === null) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  return next;
}

/** Throws for an unknown repository, and on a value the schema refuses (nothing is stored). */
export function updateJustMeSettings(repoId: string, patch: JustMePatch): RepoJustMeSettings {
  const [repo] = db.select({ id: repos.id }).from(repos).where(eq(repos.id, repoId)).limit(1).all();
  if (!repo) throw new Error(`No repository with id ${repoId}`);

  const next = repoJustMeSettingsSchema.parse(
    applyPatch(readJustMeSettings(repoId), patch as Record<string, unknown>)
  );
  const overrides = JSON.stringify(next);
  db.insert(repoSettings)
    .values({ repoId, overrides })
    .onConflictDoUpdate({ target: repoSettings.repoId, set: { overrides } })
    .run();
  return next;
}

/**
 * Edits `.chord.json` in `repoPath` (the main checkout's working tree),
 * keeping every key the patch does not name. Leaves the file as it was and
 * throws `TeamFileOffBaseError` when the checkout's branch does not have
 * `baseRef`'s file committed, or `RepoConfigError` when the file there
 * cannot be parsed or the change would make it invalid.
 */
export async function writeTeamConfigFile(
  repoPath: string,
  baseRef: string,
  patch: TeamConfigPatch
): Promise<{ path: string }> {
  await assertTeamFileOnBase(repoPath, baseRef);
  const file = path.join(repoPath, TEAM_CONFIG_FILE);
  let current: Record<string, unknown> = {};
  if (existsSync(file)) {
    const raw = await readFile(file, 'utf8');
    parseTeamConfig(raw, file);
    current = JSON.parse(raw) as Record<string, unknown>;
  }
  const next = applyPatch(current, patch as Record<string, unknown>);
  const text = `${JSON.stringify(next, null, 2)}\n`;
  parseTeamConfig(text, file);
  await writeFile(file, text, 'utf8');
  return { path: file };
}
