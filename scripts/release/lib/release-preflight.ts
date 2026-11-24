import { execFileSync } from 'node:child_process';
import { extractSection } from './changelog.ts';
import { meetsMinimum, readMinDesktopVersion } from './min-desktop.ts';
import { parseReleaseTag } from './release-plan.ts';

/**
 * The release decision for a CI-green commit of main (devstation-pqub, C4): release.yml's
 * preflight job makes it, and every later job reads its outputs. A release is a merged
 * `chore(release): <tag> (<bead>)` commit that moved the version in package.json; release.yml
 * then creates the tag. A rerun of that run finds the tag at the same commit and carries on.
 */

/**
 * The files a release commit may touch: the harness's `release.version_files`
 * (.command-center/.workflows/harness.json), which the release gate holds the commit to as well.
 */
const RELEASE_VERSION_FILES = ['package.json', 'server/package.json', 'CHANGELOG.md'];

/** What the server deploy depends on: its own tree and the wire contract it serves (F7). */
const SERVER_PATHS = ['server', 'packages/protocol'];
const MIN_DESKTOP_FILE = 'packages/protocol/src/version.ts';
const BEAD = String.raw`\([a-z]+-[a-z0-9]+(\.[0-9]+)*\)`;

export type ReleaseDecision =
  | { release: false; reason: string }
  | {
      release: true;
      /** The tag already points at this commit: a rerun of the same release. */
      rerun: boolean;
      tag: string;
      /** The newest release tag of any channel this commit contains. */
      previous: string | null;
      channel: 'stable' | 'canary';
      /**
       * deployed..sha touches server/ or packages/protocol/, or the server names no release.
       * Measured from what the server runs, not `previous`: a tag whose deploy failed still owes it.
       */
      server: boolean;
      /** MIN_DESKTOP_VERSION differs from the server's: the server deploys after the probe. */
      minDesktopRaised: boolean;
      /**
       * The tag the live server runs (null: none). The migration lint's base: after a failed
       * deploy, a contract migration must stay safe for the release still live, not `previous`.
       */
      deployed: string | null;
    };

const git = (cwd: string, args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const showFile = (cwd: string, ref: string, path: string) => git(cwd, ['show', `${ref}:${path}`]);
/** The file at `ref`, or null when `ref` has no such path; a missing ref or object throws. */
const showFileOrNull = (cwd: string, ref: string, path: string) =>
  git(cwd, ['ls-tree', '--name-only', ref, '--', path]) === '' ? null : showFile(cwd, ref, path);
const readVersion = (cwd: string, ref: string, path: string): string =>
  (JSON.parse(showFile(cwd, ref, path)) as { version: string }).version;

/** The commit the tag points at, or null when there is no such tag; a broken tag throws. */
function tagCommit(cwd: string, tag: string): string | null {
  const ref = `refs/tags/${tag}`;
  if (git(cwd, ['for-each-ref', '--format=%(objectname)', ref]) === '') return null;
  return git(cwd, ['rev-parse', '--verify', `${ref}^{commit}`]);
}

/** The first parent, or null for a root commit; a missing object throws. */
const firstParent = (cwd: string, head: string): string | null =>
  git(cwd, ['rev-list', '--parents', '-n', '1', head]).split(' ')[1] ?? null;

/** Release tags rank by version; a canary sorts below its stable release. */
function rank(tag: string): number[] {
  const { major, minor, patch, canary } = parseReleaseTag(tag);
  return [major, minor, patch, canary ?? Number.MAX_SAFE_INTEGER];
}

function readPreviousTag(cwd: string, sha: string, tag: string): string | null {
  const tags = git(cwd, ['tag', '--merged', sha, '--list', 'v*'])
    .split('\n')
    .map((t) => t.trim())
    .filter((t) => t !== '' && t !== tag && /^v\d+\.\d+\.\d+(-canary\.\d+)?$/.test(t));
  tags.sort((a, b) => {
    const [x, y] = [rank(a), rank(b)];
    const i = x.findIndex((v, k) => v !== y[k]);
    return i === -1 ? 0 : x[i] - y[i];
  });
  return tags.at(-1) ?? null;
}

/** The one commit of the range with the release subject; throws unless it touches only the version files. */
function assertReleaseCommit(cwd: string, range: string, tag: string): void {
  const subject = new RegExp(`^chore\\(release\\): ${tag.replace(/\./g, '\\.')} ${BEAD}$`);
  const commits = git(cwd, ['log', '--no-merges', '--format=%H%x1f%s', '--end-of-options', range])
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.split('\x1f'))
    .filter(([, s]) => subject.test(s));
  if (commits.length === 0) {
    throw new Error(
      `package.json names ${tag}, but ${range} has no commit 'chore(release): ${tag} (<bead>)': ` +
        'a version moves only in a release PR'
    );
  }
  if (commits.length > 1) {
    throw new Error(
      `${range} has ${commits.length} commits 'chore(release): ${tag}'; one is a release`
    );
  }
  const [sha] = commits[0];
  const touched = git(cwd, ['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', sha])
    .split('\n')
    .filter((path) => path !== '');
  const extra = touched.filter((path) => !RELEASE_VERSION_FILES.includes(path));
  if (extra.length > 0) {
    throw new Error(
      `the release commit ${sha.slice(0, 12)} touches more than ${RELEASE_VERSION_FILES.join(', ')}: ${extra.join(', ')}`
    );
  }
}

/**
 * Whether previous..head changes the server or the protocol. Every release commit moves
 * server/package.json's version, which alone changes nothing the server runs.
 */
function touchesServer(cwd: string, previous: string, head: string): boolean {
  const changed = git(cwd, ['diff', '--name-only', previous, head, '--', ...SERVER_PATHS])
    .split('\n')
    .filter((path) => path !== '');
  return changed.some((path) => {
    if (path !== 'server/package.json') return true;
    const withoutVersion = (ref: string) => {
      const text = showFileOrNull(cwd, ref, path);
      if (text === null) return null;
      const { version: _version, ...rest } = JSON.parse(text) as { version: string };
      return JSON.stringify(rest);
    };
    return withoutVersion(previous) !== withoutVersion(head);
  });
}

/** Whether `sha` changes MIN_DESKTOP_VERSION from `base` (the tag the server runs). */
function readMinRaised(cwd: string, sha: string, base: string | null, version: string) {
  const min = readMinDesktopVersion(showFile(cwd, sha, MIN_DESKTOP_FILE));
  if (!meetsMinimum(version, min)) {
    throw new Error(
      `${MIN_DESKTOP_FILE} sets MIN_DESKTOP_VERSION ${min}, above this release (${version}): ` +
        'the release that raises it must meet it (server/DEPLOYMENT.md section 7)'
    );
  }
  if (base === null) return false;
  const before = showFileOrNull(cwd, base, MIN_DESKTOP_FILE);
  return before === null || readMinDesktopVersion(before) !== min;
}

/** Throws unless `deployed` is a release tag `head` contains: else the server runs elsewhere. */
function assertDeployedIn(cwd: string, deployed: string, head: string): void {
  const commit = tagCommit(cwd, deployed);
  if (commit === null) {
    throw new Error(`the server runs ${deployed}, which is not a tag of this repository`);
  }
  if (git(cwd, ['merge-base', commit, head]) !== commit) {
    throw new Error(
      `the server runs ${deployed}, which this release does not contain: a rollback or a skew to resolve first`
    );
  }
}

/**
 * The decision for `sha`; throws, naming the check, when a release fails one. `readDeployed`
 * asks the live server which release it runs (deployed-tag.ts; null for none) and is called only
 * for a release that passed its checks: a commit that is not a release never needs the server.
 */
export async function readReleaseDecision(
  cwd: string,
  sha: string,
  readDeployed: () => Promise<string | null>
): Promise<ReleaseDecision> {
  // Without history a parent or tag reads as missing, the same as a root commit or no release.
  if (git(cwd, ['rev-parse', '--is-shallow-repository']) === 'true') {
    throw new Error(
      'preflight needs the full history and tags, not a shallow clone (checkout fetch-depth: 0)'
    );
  }
  const head = git(cwd, ['rev-parse', '--verify', `${sha}^{commit}`]);
  const version = readVersion(cwd, head, 'package.json');
  const tag = `v${version}`;
  const tagged = tagCommit(cwd, tag);
  if (tagged !== null && tagged !== head) {
    return { release: false, reason: `${tag} is already tagged at ${tagged.slice(0, 12)}` };
  }
  if (tagged === null) {
    const parent = firstParent(cwd, head);
    if (parent !== null && readVersion(cwd, parent, 'package.json') === version) {
      return {
        release: false,
        reason: `package.json still names ${tag}, untagged: no release PR merged`,
      };
    }
  }
  parseReleaseTag(tag);
  const serverVersion = readVersion(cwd, head, 'server/package.json');
  if (serverVersion !== version) {
    throw new Error(`package.json names ${version} but server/package.json names ${serverVersion}`);
  }
  extractSection(showFile(cwd, head, 'CHANGELOG.md'), tag);
  const previous = readPreviousTag(cwd, head, tag);
  const range = previous ? `${previous}..${head}` : head;
  assertReleaseCommit(cwd, range, tag);
  const deployed = await readDeployed();
  if (deployed !== null) assertDeployedIn(cwd, deployed, head);
  const server = deployed === null || touchesServer(cwd, deployed, head);
  return {
    release: true,
    rerun: tagged === head,
    tag,
    previous,
    channel: parseReleaseTag(tag).canary === null ? 'stable' : 'canary',
    server,
    minDesktopRaised: readMinRaised(cwd, head, deployed ?? previous, version),
    deployed,
  };
}

/** The decision as `$GITHUB_OUTPUT` lines; a non-release writes only release=false. */
export function formatReleaseOutputs(decision: ReleaseDecision): string {
  if (!decision.release) return 'release=false\n';
  const outputs: [string, string | boolean | null][] = [
    ['release', true],
    ['rerun', decision.rerun],
    ['tag', decision.tag],
    ['previous', decision.previous],
    ['channel', decision.channel],
    ['server', decision.server],
    ['min_desktop_raised', decision.minDesktopRaised],
    ['deployed', decision.deployed],
  ];
  return outputs.map(([key, value]) => `${key}=${value ?? ''}\n`).join('');
}
