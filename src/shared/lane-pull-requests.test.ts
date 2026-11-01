import { describe, expect, it } from 'vitest';
import {
  buildLanePrRequest,
  splitRemoteRef,
  type LanePr,
  type LanePullRequest,
} from './lane-pull-requests';

const REPO = 'https://github.com/acme/chord';

const OPEN_PR: LanePr = {
  number: 7,
  url: `${REPO}/pull/7`,
  title: 'Primary work',
  status: 'open',
  isDraft: false,
  headRefName: 'raghav/login',
  baseRefName: 'main',
  headRefOid: 'a'.repeat(40),
  mergeableStatus: 'MERGEABLE',
  reviewDecision: null,
  checks: 'none',
};

/** A secondary lane: its own branch, merging into a release branch, no PR yet. */
const SECONDARY: LanePullRequest = {
  worktreeId: 'lane-b',
  branchName: 'raghav/login--api',
  isPrimary: false,
  targetRef: 'origin/release/2.0',
  prBase: 'release/2.0',
  targetError: null,
  pr: null,
};

describe('splitRemoteRef', () => {
  it('names the remote and the branch GitHub knows', () => {
    expect(splitRemoteRef('origin/main', ['origin'])).toEqual({ remote: 'origin', branch: 'main' });
  });

  it('keeps the slashes that belong to the branch', () => {
    expect(splitRemoteRef('origin/release/2.0', ['origin'])).toEqual({
      remote: 'origin',
      branch: 'release/2.0',
    });
  });

  it('picks the longest remote name that prefixes the ref', () => {
    expect(splitRemoteRef('up/stream/main', ['up', 'up/stream'])).toEqual({
      remote: 'up/stream',
      branch: 'main',
    });
  });

  it('is null for a local branch whose first segment is not a remote', () => {
    expect(splitRemoteRef('feature/x', ['origin'])).toBeNull();
    expect(splitRemoteRef('main', [])).toBeNull();
  });
});

describe('buildLanePrRequest — the PR is opened from the lane, not the work item', () => {
  const input = {
    repositoryUrl: REPO,
    lane: SECONDARY,
    title: 'Login API',
    body: 'Splits the API out.',
    draft: false,
  };

  it("uses the lane's branch as head and its target_ref, without the remote, as base", () => {
    expect(buildLanePrRequest(input)).toEqual({
      success: true,
      data: {
        repositoryUrl: REPO,
        head: 'raghav/login--api',
        base: 'release/2.0',
        title: 'Login API',
        body: 'Splits the API out.',
        draft: false,
      },
    });
  });

  it('sends the title and body the user wrote, trimmed, and the draft choice', () => {
    const result = buildLanePrRequest({ ...input, title: '  Login API  ', draft: true });
    expect(result.success && result.data.title).toBe('Login API');
    expect(result.success && result.data.draft).toBe(true);
  });

  it('refuses a lane that already has a pull request, naming it', () => {
    expect(buildLanePrRequest({ ...input, lane: { ...SECONDARY, pr: OPEN_PR } })).toEqual({
      success: false,
      error: { type: 'pr_exists', number: 7, url: OPEN_PR.url },
    });
  });

  it('refuses a repository with no GitHub remote', () => {
    expect(buildLanePrRequest({ ...input, repositoryUrl: null })).toEqual({
      success: false,
      error: { type: 'no_github_remote' },
    });
  });

  it('refuses a lane on a detached HEAD', () => {
    expect(buildLanePrRequest({ ...input, lane: { ...SECONDARY, branchName: null } })).toEqual({
      success: false,
      error: { type: 'no_branch' },
    });
  });

  it('refuses a lane whose target could not be resolved, with the reason', () => {
    const lane: LanePullRequest = {
      ...SECONDARY,
      targetRef: null,
      prBase: null,
      targetError: "Could not find origin's default branch (origin/HEAD).",
    };
    expect(buildLanePrRequest({ ...input, lane })).toEqual({
      success: false,
      error: { type: 'no_target', message: lane.targetError },
    });
  });

  it('refuses a lane whose branch is its own target', () => {
    const lane: LanePullRequest = { ...SECONDARY, branchName: 'release/2.0' };
    expect(buildLanePrRequest({ ...input, lane })).toEqual({
      success: false,
      error: { type: 'on_target', branch: 'release/2.0' },
    });
  });

  it('refuses an empty title', () => {
    expect(buildLanePrRequest({ ...input, title: '   ' })).toEqual({
      success: false,
      error: { type: 'empty_title' },
    });
  });
});
