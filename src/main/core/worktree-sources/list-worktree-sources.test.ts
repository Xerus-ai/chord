import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { updateJustMeSettings } from '@main/core/repo-config/repo-settings-writes';
import { readJustMeSettings } from '@main/core/repo-config/resolve-repo-config';
import { appSettingsService } from '@main/core/settings/settings-service';
import { db } from '@main/db/client';
import { repos } from '@main/db/schema-work-items';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import {
  addWorktree,
  claudeWorktreePath,
  createScratchRepo,
  type ScratchRepo,
} from './_testing/scratch-worktrees';
import { listAllRepoWorktreeSources, listRepoWorktreeSources } from './list-worktree-sources';

/**
 * What a repository's discovered checkouts look like in the left rail (plan
 * §Phase 3 slice 6): `worktreeSources` — the user's setting, overridden per
 * repository in Repo › General (just me) — decides which are listed with
 * Adopt; the rest are counted in one "Review N worktrees" line, which
 * "Hide for this repo" takes away. Real repositories, the real settings store
 * and the real `repo_settings` row.
 */
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const REPO_A = 'repo-a';
const REPO_B = 'repo-b';

let a: ScratchRepo;
let b: ScratchRepo;
let aClaude: string;
let aOther: string;
let bOther: string;

const pathsOf = (worktrees: { path: string }[]) => worktrees.map((w) => w.path).sort();

beforeAll(() => {
  a = createScratchRepo('chord-sources-a-');
  aClaude = path.resolve(addWorktree(a.repo, claudeWorktreePath(a.repo, 'x'), 'claude/x'));
  aOther = path.resolve(addWorktree(a.repo, path.join(a.root, 'side'), 'feature/side'));
  b = createScratchRepo('chord-sources-b-');
  bOther = path.resolve(addWorktree(b.repo, path.join(b.root, 'side'), 'feature/b-side'));
});

afterAll(() => {
  for (const scratch of [a, b]) {
    removeDirSync(scratch.root);
  }
});

beforeEach(() => {
  db.insert(repos)
    .values([
      { id: REPO_A, path: a.repo, alias: 'a' },
      { id: REPO_B, path: b.repo, alias: 'b' },
    ])
    .run();
});

afterEach(async () => {
  await appSettingsService.reset('worktreeSources');
  db.delete(repos).run();
});

describe('listRepoWorktreeSources', () => {
  it("lists Claude Code's worktrees with Adopt and counts other ones for review, by default", async () => {
    const sources = await listRepoWorktreeSources(REPO_A);

    expect(pathsOf(sources.listed)).toEqual([aClaude]);
    expect(pathsOf(sources.review)).toEqual([aOther]);
  });

  it('lists a source the user shows, everywhere', async () => {
    await appSettingsService.update('worktreeSources', { claudeCode: 'show', other: 'show' });

    expect(pathsOf((await listRepoWorktreeSources(REPO_A)).listed)).toEqual(
      [aClaude, aOther].sort()
    );
    expect((await listRepoWorktreeSources(REPO_A)).review).toEqual([]);
    expect(pathsOf((await listRepoWorktreeSources(REPO_B)).listed)).toEqual([bOther]);
  });

  it('counts a source the user hides for review instead of listing it', async () => {
    await appSettingsService.update('worktreeSources', { claudeCode: 'hide', other: 'hide' });

    const sources = await listRepoWorktreeSources(REPO_A);

    expect(sources.listed).toEqual([]);
    expect(pathsOf(sources.review)).toEqual([aClaude, aOther].sort());
  });

  it("applies a repository's just-me override to that repository only", async () => {
    updateJustMeSettings(REPO_A, { worktreeSources: { other: 'show' } });

    expect(pathsOf((await listRepoWorktreeSources(REPO_A)).listed)).toEqual(
      [aClaude, aOther].sort()
    );
    // Repository B still follows the user's setting: other is hidden.
    const bSources = await listRepoWorktreeSources(REPO_B);
    expect(bSources.listed).toEqual([]);
    expect(pathsOf(bSources.review)).toEqual([bOther]);
  });

  it('a just-me override of one source leaves the other on the user’s setting', async () => {
    await appSettingsService.update('worktreeSources', { claudeCode: 'hide', other: 'show' });
    updateJustMeSettings(REPO_A, { worktreeSources: { claudeCode: 'show' } });

    expect(pathsOf((await listRepoWorktreeSources(REPO_A)).listed)).toEqual(
      [aClaude, aOther].sort()
    );
  });

  it('"Hide for this repo" takes the review line away and leaves the listed ones', async () => {
    updateJustMeSettings(REPO_A, { hideWorktreeReview: true });

    const hidden = await listRepoWorktreeSources(REPO_A);
    expect(pathsOf(hidden.listed)).toEqual([aClaude]);
    expect(hidden.review).toEqual([]);
    // Other repositories keep theirs.
    expect(pathsOf((await listRepoWorktreeSources(REPO_B)).review)).toEqual([bOther]);

    // Clearing the override brings it back.
    updateJustMeSettings(REPO_A, { hideWorktreeReview: null });
    expect(pathsOf((await listRepoWorktreeSources(REPO_A)).review)).toEqual([aOther]);
  });

  it('refuses a source visibility other than show or hide, and stores nothing', () => {
    updateJustMeSettings(REPO_A, { worktreeSources: { other: 'show' } });

    expect(() =>
      updateJustMeSettings(REPO_A, {
        worktreeSources: { claudeCode: 'sometimes' } as unknown as { claudeCode: 'show' },
      })
    ).toThrow();
    expect(readJustMeSettings(REPO_A)).toEqual({ worktreeSources: { other: 'show' } });
  });
});

describe('listAllRepoWorktreeSources', () => {
  // A registered repository whose folder was deleted outside Chord — an e2e
  // scratch repo under %TEMP% that was cleaned up (devstation-lq9d).
  it('names a repository whose folder is gone as missing, and still lists the others', async () => {
    const gone = path.join(a.root, 'deleted-repo');
    db.insert(repos).values({ id: 'repo-gone', path: gone, alias: 'gone' }).run();

    const { repos: listed, failures } = await listAllRepoWorktreeSources();

    expect(failures).toEqual([
      {
        repoId: 'repo-gone',
        message: `The folder ${gone} does not exist`,
        folderMissing: true,
      },
    ]);
    expect(listed.map((sources) => sources.repoId).sort()).toEqual([REPO_A, REPO_B]);
  });
});
