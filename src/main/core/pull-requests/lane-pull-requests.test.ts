import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { db } from '@main/db/client';
import { pullRequestChecks, pullRequests } from '@main/db/schema';
import { workItems, workItemWorktrees } from '@main/db/schema-work-items';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { readLanePullRequests } from './lane-pull-requests';
import { readWorkItemChecks, readWorkItemReviews } from './pr-work-item-reads';

vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const REPO_URL = 'https://github.com/acme/chord';
const FORK_URL = 'https://github.com/someone/chord';
const ITEM = 'item-1';
const LANE_A = 'lane-a';
const LANE_B = 'lane-b';
const LANE_C = 'lane-c';
const LANE_ARCHIVED = 'lane-archived';
const HEAD_A = 'a'.repeat(40);
const HEAD_B = 'b'.repeat(40);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: cwd }).exec(GIT_EXECUTABLE, args);
  return stdout.trim();
}

/**
 * A checkout whose origin is a GitHub repository, with `origin/main` and
 * `origin/HEAD` recorded the way a clone records them — no network needed.
 */
async function createCheckout(root: string, originUrl: string | null): Promise<string> {
  const repo = path.join(root, 'chord');
  fs.mkdirSync(repo);
  await git(['init', '-q', '-b', 'main'], repo);
  await git(['config', 'user.email', 'test@chord.invalid'], repo);
  await git(['config', 'user.name', 'Chord test'], repo);
  fs.writeFileSync(path.join(repo, 'README.md'), '# chord\n');
  await git(['add', 'README.md'], repo);
  await git(['commit', '-q', '-m', 'readme'], repo);
  if (originUrl) {
    await git(['remote', 'add', 'origin', originUrl], repo);
    await git(['update-ref', 'refs/remotes/origin/main', 'HEAD'], repo);
    await git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'], repo);
  }
  return repo;
}

function insertPr(args: {
  number: number;
  headRefName: string;
  headRefOid: string;
  headRepositoryUrl?: string;
  status?: string;
  isDraft?: boolean;
  updatedAt?: string;
}): string {
  const url = `${REPO_URL}/pull/${args.number}`;
  db.insert(pullRequests)
    .values({
      url,
      repositoryUrl: REPO_URL,
      baseRefName: 'main',
      baseRefOid: 'c'.repeat(40),
      headRepositoryUrl: args.headRepositoryUrl ?? REPO_URL,
      headRefName: args.headRefName,
      headRefOid: args.headRefOid,
      identifier: `#${args.number}`,
      title: `PR ${args.number}`,
      status: args.status ?? 'open',
      isDraft: args.isDraft ? 1 : 0,
      mergeableStatus: 'MERGEABLE',
      pullRequestUpdatedAt: args.updatedAt ?? '2026-10-01T00:00:00Z',
    })
    .run();
  return url;
}

function insertCheck(prUrl: string, commitSha: string, status: string, conclusion: string): void {
  db.insert(pullRequestChecks)
    .values({
      id: `${prUrl}:${status}:${conclusion}:${commitSha.slice(0, 4)}`,
      pullRequestUrl: prUrl,
      commitSha,
      name: 'ci',
      status,
      conclusion,
    })
    .run();
}

let root: string;
let repo: string;

/** One work item, three live lanes and an archived one. */
async function seedWorkItem(originUrl: string | null): Promise<void> {
  repo = await createCheckout(root, originUrl);
  db.insert(workItems)
    .values({ id: ITEM, name: 'Login', repoPath: repo, branchName: 'raghav/login' })
    .run();
  db.insert(workItemWorktrees)
    .values([
      {
        id: LANE_A,
        workItemId: ITEM,
        path: repo,
        branchName: 'raghav/login',
        isPrimary: 1,
        targetRef: 'origin/main',
      },
      {
        id: LANE_B,
        workItemId: ITEM,
        path: path.join(root, 'lane-b'),
        branchName: 'raghav/login--api',
        isPrimary: 0,
        targetRef: 'origin/release/2.0',
      },
      {
        // A lane from before target_ref was recorded.
        id: LANE_C,
        workItemId: ITEM,
        path: path.join(root, 'lane-c'),
        branchName: 'raghav/login--docs',
        isPrimary: 0,
        targetRef: null,
      },
      {
        id: LANE_ARCHIVED,
        workItemId: ITEM,
        path: path.join(root, 'lane-old'),
        branchName: 'raghav/login--old',
        isPrimary: 0,
        targetRef: 'origin/main',
        archivedAt: 1_700_000_000,
      },
    ])
    .run();
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'chord-lane-prs-'));
});

afterEach(() => {
  db.delete(pullRequests).run();
  db.delete(workItems).run();
  removeDirSync(root);
});

describe('readLanePullRequests — a PR belongs to the lane whose branch is its head', () => {
  it("gives each live lane the PR whose head is that lane's branch in the checkout's GitHub repository", async () => {
    await seedWorkItem(`${REPO_URL}.git`);
    insertPr({ number: 7, headRefName: 'raghav/login', headRefOid: HEAD_A });
    insertPr({ number: 12, headRefName: 'raghav/login--api', headRefOid: HEAD_B });
    insertPr({ number: 30, headRefName: 'raghav/login--old', headRefOid: HEAD_B });

    const result = await readLanePullRequests(ITEM);

    expect(result?.repositoryUrl).toBe(REPO_URL);
    expect(result?.lanes.map((lane) => [lane.worktreeId, lane.pr?.number ?? null])).toEqual([
      [LANE_A, 7],
      [LANE_B, 12],
      [LANE_C, null],
    ]);
    expect(result?.lanes.find((lane) => lane.worktreeId === LANE_B)?.pr).toMatchObject({
      url: `${REPO_URL}/pull/12`,
      headRefName: 'raghav/login--api',
      headRefOid: HEAD_B,
      status: 'open',
      isDraft: false,
    });
  });

  it('does not take a PR from another repository whose head branch has the same name', async () => {
    await seedWorkItem(`${REPO_URL}.git`);
    insertPr({
      number: 40,
      headRefName: 'raghav/login--api',
      headRefOid: HEAD_B,
      headRepositoryUrl: FORK_URL,
    });

    const result = await readLanePullRequests(ITEM);

    expect(result?.lanes.find((lane) => lane.worktreeId === LANE_B)?.pr).toBeNull();
  });

  it('takes the most recently updated PR when the branch was reused', async () => {
    await seedWorkItem(`${REPO_URL}.git`);
    insertPr({
      number: 3,
      headRefName: 'raghav/login--api',
      headRefOid: HEAD_B,
      status: 'closed',
      updatedAt: '2026-09-01T00:00:00Z',
    });
    insertPr({
      number: 9,
      headRefName: 'raghav/login--api',
      headRefOid: HEAD_B,
      updatedAt: '2026-09-20T00:00:00Z',
    });

    const result = await readLanePullRequests(ITEM);

    expect(result?.lanes.find((lane) => lane.worktreeId === LANE_B)?.pr?.number).toBe(9);
  });

  it("summarises the checks on each lane's PR head commit", async () => {
    await seedWorkItem(`${REPO_URL}.git`);
    const primaryPr = insertPr({ number: 7, headRefName: 'raghav/login', headRefOid: HEAD_A });
    const secondaryPr = insertPr({
      number: 12,
      headRefName: 'raghav/login--api',
      headRefOid: HEAD_B,
    });
    insertCheck(primaryPr, HEAD_A, 'COMPLETED', 'SUCCESS');
    insertCheck(secondaryPr, HEAD_B, 'COMPLETED', 'FAILURE');
    // A failure on an older commit says nothing about the current head.
    insertCheck(primaryPr, 'd'.repeat(40), 'COMPLETED', 'FAILURE');

    const result = await readLanePullRequests(ITEM);

    const checksOf = (id: string) =>
      result?.lanes.find((lane) => lane.worktreeId === id)?.pr?.checks;
    expect(checksOf(LANE_A)).toBe('passing');
    expect(checksOf(LANE_B)).toBe('failing');
  });

  it("names each lane's PR base: its target_ref without the remote", async () => {
    await seedWorkItem(`${REPO_URL}.git`);

    const result = await readLanePullRequests(ITEM);

    const targetOf = (id: string) => {
      const lane = result?.lanes.find((row) => row.worktreeId === id);
      return { targetRef: lane?.targetRef, prBase: lane?.prBase, targetError: lane?.targetError };
    };
    expect(targetOf(LANE_A)).toEqual({
      targetRef: 'origin/main',
      prBase: 'main',
      targetError: null,
    });
    expect(targetOf(LANE_B)).toEqual({
      targetRef: 'origin/release/2.0',
      prBase: 'release/2.0',
      targetError: null,
    });
    // No recorded target: the repository's default, as this clone knows it.
    expect(targetOf(LANE_C)).toEqual({
      targetRef: 'origin/main',
      prBase: 'main',
      targetError: null,
    });
  });

  it('lists the primary first, and every lane carries its branch and primacy', async () => {
    await seedWorkItem(`${REPO_URL}.git`);

    const result = await readLanePullRequests(ITEM);

    expect(result?.lanes[0]).toMatchObject({
      worktreeId: LANE_A,
      branchName: 'raghav/login',
      isPrimary: true,
    });
    expect(result?.lanes.slice(1).every((lane) => !lane.isPrimary)).toBe(true);
  });

  it('has no repository and no PRs when the checkout has no GitHub remote', async () => {
    await seedWorkItem(null);
    insertPr({ number: 7, headRefName: 'raghav/login', headRefOid: HEAD_A });

    const result = await readLanePullRequests(ITEM);

    expect(result?.repositoryUrl).toBeNull();
    expect(result?.lanes.every((lane) => lane.pr === null)).toBe(true);
  });

  it('is null for a work item that does not exist', async () => {
    expect(await readLanePullRequests('missing')).toBeNull();
  });
});

describe('checks and reviews follow the lane they are asked for', () => {
  it("reads the secondary lane's PR checks, not the primary's", async () => {
    await seedWorkItem(`${REPO_URL}.git`);
    const primaryPr = insertPr({ number: 7, headRefName: 'raghav/login', headRefOid: HEAD_A });
    const secondaryPr = insertPr({
      number: 12,
      headRefName: 'raghav/login--api',
      headRefOid: HEAD_B,
    });
    insertCheck(primaryPr, HEAD_A, 'COMPLETED', 'SUCCESS');
    insertCheck(secondaryPr, HEAD_B, 'IN_PROGRESS', '');

    const secondary = await readWorkItemChecks(ITEM, LANE_B);
    const primary = await readWorkItemChecks(ITEM, LANE_A);

    expect(secondary.checks.map((check) => check.pullRequestUrl)).toEqual([secondaryPr]);
    expect(primary.checks.map((check) => check.pullRequestUrl)).toEqual([primaryPr]);
  });

  it('reads no checks or reviews for a lane without a PR, even when the primary has one', async () => {
    await seedWorkItem(`${REPO_URL}.git`);
    const primaryPr = insertPr({ number: 7, headRefName: 'raghav/login', headRefOid: HEAD_A });
    insertCheck(primaryPr, HEAD_A, 'COMPLETED', 'SUCCESS');

    expect((await readWorkItemChecks(ITEM, LANE_C)).checks).toEqual([]);
    expect(await readWorkItemReviews(ITEM, LANE_C)).toEqual([]);
  });

  it('reads the primary lane when no lane is named', async () => {
    await seedWorkItem(`${REPO_URL}.git`);
    const primaryPr = insertPr({ number: 7, headRefName: 'raghav/login', headRefOid: HEAD_A });
    insertCheck(primaryPr, HEAD_A, 'COMPLETED', 'SUCCESS');

    const checks = await readWorkItemChecks(ITEM);

    expect(checks.checks.map((check) => check.pullRequestUrl)).toEqual([primaryPr]);
  });
});
