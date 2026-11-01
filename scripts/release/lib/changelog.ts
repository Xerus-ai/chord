import { execFileSync } from 'node:child_process';

/**
 * CHANGELOG.md, one `## vX.Y.Z (YYYY-MM-DD)` section per release, newest first (pipeline D6,
 * F21). A section is the GitHub Release body and the builder's release notes, so a running
 * app's update manifest carries it as `releaseNotes`.
 *
 * The commit rule, as the harness's commit gate applies it to every agent commit
 * (`commit.subject_pattern` in its harness.json): `type(scope): description (bead-id)`.
 */
export const SUBJECT_PATTERN =
  /^(feat|fix|refactor|chore|docs|test|perf|build|ci)(\(([a-z0-9-]+)\))?: (.+ \([a-z]+-[a-z0-9]+(\.[0-9]+)*\))$/;

/** The version commit a release makes itself: not a change to list. */
const RELEASE_COMMIT = /^chore\(release\): v\d/;
const HEADER = '# Changelog\n';
const GROUPS: { title: string; types: string[] }[] = [
  { title: 'Features', types: ['feat'] },
  { title: 'Fixes', types: ['fix'] },
  { title: 'Performance', types: ['perf'] },
  { title: 'Other', types: ['refactor', 'chore', 'docs', 'test', 'build', 'ci'] },
];

/** The release tag grammar (the /release gate's tag phase): stable vX.Y.Z, canary vX.Y.Z-canary.N. */
const VERSION = /^v\d+\.\d+\.\d+(-canary\.\d+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertVersion(version: string): void {
  if (!VERSION.test(version)) {
    throw new Error(`not a release version (vX.Y.Z or vX.Y.Z-canary.N): ${version}`);
  }
}

/** A version's heading; the grammar leaves only dots to escape. */
function headingOf(version: string): RegExp {
  assertVersion(version);
  return new RegExp(`^## ${version.replace(/\./g, '\\.')} \\(`, 'm');
}

/** The non-merge commit subjects of `from..to`, oldest first: parents before children, not by date. */
export function readRangeSubjects(from: string, to: string, cwd: string): string[] {
  // --end-of-options: a ref starting with '-' is a revision, never a git log option.
  const args = [
    'log',
    '--no-merges',
    '--topo-order',
    '--reverse',
    '--format=%s',
    '--end-of-options',
    `${from}..${to}`,
  ];
  const out = execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
  });
  return out.split('\n').filter((line) => line.trim() !== '');
}

/** A release's section: its commits grouped by type, under `## <version> (<date>)`. */
export function buildSection(version: string, date: string, subjects: string[]): string {
  assertVersion(version);
  if (!DATE.test(date)) throw new Error(`not a date (YYYY-MM-DD): ${date}`);
  const changes = subjects.filter((subject) => !RELEASE_COMMIT.test(subject));
  const broken = changes.filter((subject) => !SUBJECT_PATTERN.test(subject));
  if (broken.length > 0) {
    throw new Error(
      `${broken.length} commit subject(s) break the commit rule:\n${broken.map((s) => `  - ${s}`).join('\n')}`
    );
  }
  if (changes.length === 0) throw new Error(`no commits to release in ${version}`);
  const lines = [`## ${version} (${date})`, ''];
  for (const group of GROUPS) {
    const entries = changes.flatMap((subject) => {
      const [, type, , scope, description] = SUBJECT_PATTERN.exec(subject) ?? [];
      if (!group.types.includes(type)) return [];
      return [scope ? `- **${scope}:** ${description}` : `- ${description}`];
    });
    if (entries.length > 0) lines.push(`### ${group.title}`, '', ...entries, '');
  }
  return lines.join('\n');
}

/** The changelog with `section` first under its header; a version already there is refused. */
export function insertSection(changelog: string | null, section: string): string {
  const version = /^## (\S+) \(/.exec(section)?.[1];
  if (!version) throw new Error('a section starts with ## vX.Y.Z (YYYY-MM-DD)');
  const current = changelog ?? HEADER;
  if (!current.startsWith(HEADER))
    throw new Error('CHANGELOG.md does not start with "# Changelog"');
  if (headingOf(version).test(current)) throw new Error(`CHANGELOG.md already has ${version}`);
  const rest = current.slice(HEADER.length).replace(/^\n+/, '');
  return `${HEADER}\n${section}${rest ? `\n${rest}` : ''}`;
}

/** A version's section without its heading: the release notes and the GitHub Release body. */
export function extractSection(changelog: string, version: string): string {
  const start = headingOf(version).exec(changelog);
  if (!start) throw new Error(`CHANGELOG.md has no section for ${version}`);
  const body = changelog.slice(start.index).split('\n').slice(1).join('\n');
  const end = body.search(/^## /m);
  return `${(end === -1 ? body : body.slice(0, end)).trim()}\n`;
}
