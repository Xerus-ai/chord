import { execFileSync } from 'node:child_process';
import { SUBJECT_PATTERN } from './changelog.ts';

/**
 * What the next release carries (devstation-g98j, C3): the commits since the last stable tag,
 * each held to the commit rule, and the version they add up to. The first release is v1.0.0;
 * after it a feature bumps the minor and anything else the patch. A major bump is refused: it
 * needs a mission (D12). The release gate's notes phase reads this through release-plan.ts.
 */

export interface ReleaseTagParts {
  major: number;
  minor: number;
  patch: number;
  canary: number | null;
}

export interface ReleaseCommit {
  sha: string;
  subject: string;
}

export interface ReleasePlan {
  /** The last stable tag the range starts after, or null before the first release. */
  from: string | null;
  tag: string;
  commits: ReleaseCommit[];
}

const RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-canary\.(0|[1-9]\d*))?$/;

/** The parts of a release tag: `vX.Y.Z` (stable) or `vX.Y.Z-canary.N`. Anything else throws. */
export function parseReleaseTag(tag: string): ReleaseTagParts {
  const m = RELEASE_TAG.exec(tag);
  if (!m) throw new Error(`${tag} is not a release tag (vX.Y.Z or vX.Y.Z-canary.N)`);
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    canary: m[4] === undefined ? null : Number(m[4]),
  };
}

const isBreaking = (message: string) =>
  /^[a-z]+(\([a-z0-9-]+\))?!:/.test(message) || /^BREAKING[ -]CHANGE:/m.test(message);

/** The tag after `previous` (a stable tag, or null for the first release) for these commit messages. */
export function nextReleaseTag(previous: string | null, messages: string[]): string {
  if (messages.length === 0)
    throw new Error('no commits since the last release: nothing to release');
  const breaking = messages.find(isBreaking);
  if (breaking) {
    throw new Error(`a major release needs a mission (D12): ${breaking.split('\n')[0]}`);
  }
  if (previous === null) return 'v1.0.0';
  const { major, minor, patch } = parseReleaseTag(previous);
  const hasFeature = messages.some((message) => /^feat(\(|:)/.test(message));
  return hasFeature ? `v${major}.${minor + 1}.0` : `v${major}.${minor}.${patch + 1}`;
}

const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' });

/** The highest stable release tag HEAD contains, or null. */
function readLastStableTag(cwd: string): string | null {
  const stable = git(cwd, ['tag', '--merged', 'HEAD', '--list', 'v*'])
    .split('\n')
    .map((tag) => tag.trim())
    .filter((tag) => RELEASE_TAG.test(tag) && parseReleaseTag(tag).canary === null);
  const rank = (tag: string) => {
    const { major, minor, patch } = parseReleaseTag(tag);
    return [major, minor, patch];
  };
  stable.sort((a, b) => {
    const [x, y] = [rank(a), rank(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
  return stable.at(-1) ?? null;
}

/** The release plan for the repository at `cwd`; throws naming every commit that breaks the rule. */
export function readReleasePlan(cwd: string): ReleasePlan {
  const from = readLastStableTag(cwd);
  // %x1f between sha and message, %x1e after each commit: neither occurs in a commit message.
  const out = git(cwd, [
    'log',
    '--no-merges',
    '--topo-order',
    '--reverse',
    '--format=%H%x1f%B%x1e',
    '--end-of-options',
    from ? `${from}..HEAD` : 'HEAD',
  ]);
  const commits = out
    .split('\x1e')
    .map((record) => record.trim())
    .filter((record) => record !== '')
    .map((record) => {
      const [sha, message] = record.split('\x1f');
      return { sha, message: message.trim(), subject: message.trim().split('\n')[0] };
    });
  const breakers = commits.filter((commit) => !SUBJECT_PATTERN.test(commit.subject));
  if (breakers.length > 0) {
    const lines = breakers.map((commit) => `${commit.sha.slice(0, 12)} ${commit.subject}`);
    throw new Error(`these commits break the commit rule:\n${lines.join('\n')}`);
  }
  return {
    from,
    tag: nextReleaseTag(
      from,
      commits.map((commit) => commit.message)
    ),
    commits: commits.map(({ sha, subject }) => ({ sha, subject })),
  };
}
