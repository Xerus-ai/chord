import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * devstation-4x42.57: a low-tier PR merges with no human. The harness posts the change's risk tier
 * (`risk-tier`) and the verifier's verdict (`verifier`) as commit statuses on the head. The tier is
 * not taken on trust: the agents hold the token that posts statuses, so the auto-merge workflow
 * computes it again from the PR's changed files against `.github/risk-tiers.json` of the default
 * branch, and the stricter of the two decides. A file list GitHub cut short, or one it could not
 * give, is high. The workflow hands the PR, its files, its combined status and its check runs, as
 * `gh` prints them, to `scripts/auto-merge.mjs`, which answers enable, disable or none; a high-tier
 * PR waits for the permit agent's `permit` status. The script runs here as the workflow runs it: a
 * node process reading files.
 */
const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(SCRIPTS, 'auto-merge.mjs');
const TIERS = join(SCRIPTS, '..', '.github', 'risk-tiers.json');
const WORKFLOW = join(SCRIPTS, '..', '.github', 'workflows', 'auto-merge.yml');
const SHA = 'a'.repeat(40);
const dir = mkdtempSync(join(tmpdir(), 'auto-merge-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/**
 * devstation-4x42.248: `verifier` and `permit` count only from the chord-verifier App. The statuses
 * are the head's list as GitHub gives it (`.../commits/<sha>/statuses`), each with its creator.
 * RECORDED is a real one: PR #11's head, where the harness posted `risk-tier` and `verifier` with
 * the agents' token (xerus-chord-bot), the token an agent could forge them with. An App's status
 * has the same shape with the App's bot user as creator (the App is not created yet, 4x42.246).
 */
const TRUSTED = 'chord-verifier[bot]';
const RECORDED = readFileSync(
  join(SCRIPTS, '_testing', 'auto-merge', 'statuses-c4e8148.jsonl'),
  'utf8'
)
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Status);
const TOKEN_USER = RECORDED[0].creator;
const APP_USER: Creator = { ...TOKEN_USER, login: TRUSTED, type: 'Bot', id: 900000001 };
type Creator = { login: string; type: string; id: number; [key: string]: unknown };
type Status = { context: string; state: string; description: string; id: number; creator: Creator };
let nextId = Math.max(...RECORDED.map((s) => s.id));
type Run = { name: string; status: string; conclusion: string | null };
type File = { filename: string; previous_filename?: string | null; changes: number };

const pr = (over: Record<string, unknown> = {}) => ({
  number: 7,
  state: 'OPEN',
  isDraft: false,
  headRefOid: SHA,
  baseRefName: 'main',
  autoMergeRequest: null,
  changedFiles: 1,
  ...over,
});
/** A status as GitHub lists it, newer than every one before it; by default the App's. */
const status = (
  context: string,
  state: string,
  description: string,
  creator: Creator = APP_USER
): Status => ({ ...RECORDED[0], context, state, description, id: ++nextId, creator });
// The harness posts the tier with the agents' token; it needs no trust (it only makes it stricter).
const tierLow = status('risk-tier', 'success', 'low', TOKEN_USER);
const tierHigh = status('risk-tier', 'success', 'high: label area:db', TOKEN_USER);
const approve = status('verifier', 'success', 'APPROVE, round 1');
const green: Run[] = [
  { name: 'lint, typecheck, test (Linux)', status: 'completed', conclusion: 'success' },
  { name: 'build (Windows)', status: 'completed', conclusion: 'success' },
  { name: 'leak scan', status: 'completed', conclusion: 'success' },
  { name: 'auto-merge decide', status: 'in_progress', conclusion: null },
];
const small: File[] = [{ filename: 'src/main/core/lanes/lane.ts', changes: 12 }];

/** files: the PR's file list as the workflow writes it (one JSON object a line); null: gh gave none.
 *  statuses: the head's, written as the workflow writes them (one JSON object a line). */
function run(p: object, statuses: object[], runs: Run[], files: File[] | null, extra: string[]) {
  writeFileSync(join(dir, 'pr.json'), JSON.stringify(p));
  writeFileSync(join(dir, 'status.jsonl'), statuses.map((s) => JSON.stringify(s)).join('\n'));
  writeFileSync(
    join(dir, 'checks.json'),
    JSON.stringify({ total_count: runs.length, check_runs: runs })
  );
  rmSync(join(dir, 'files.jsonl'), { force: true });
  if (files)
    writeFileSync(join(dir, 'files.jsonl'), files.map((f) => JSON.stringify(f)).join('\n'));
  const args = ['--sha', SHA, '--base', 'main', '--tiers', TIERS];
  for (const [flag, file] of [
    ['--pr', 'pr.json'],
    ['--files', 'files.jsonl'],
    ['--status', 'status.jsonl'],
    ['--checks', 'checks.json'],
  ])
    args.push(flag, join(dir, file));
  args.push('--tier-context', 'risk-tier', '--verifier-context', 'verifier');
  args.push('--permit-context', 'permit');
  args.push('--ignore-check', 'auto-merge hold', '--ignore-check', 'auto-merge decide');
  return spawnSync(process.execPath, [SCRIPT, ...args, ...extra], { encoding: 'utf8' });
}

function decide(p: object, statuses: object[], runs: Run[], files: File[] | null = small) {
  const r = run(p, statuses, runs, files, ['--trusted-creator', TRUSTED]);
  if (r.status !== 0) throw new Error(`auto-merge.mjs exited ${r.status}: ${r.stdout}${r.stderr}`);
  return JSON.parse(r.stdout) as { action: string; reason: string };
}

const waitsForPermit = (why: string) =>
  `high tier (${why}): waits for the permit agent's approval (status permit)`;

describe('auto-merge of a low-tier PR (devstation-4x42.57)', () => {
  it('enables auto-merge for a low tier PR with green checks and an APPROVE verdict', () => {
    expect(decide(pr(), [tierLow, approve], green)).toEqual({
      action: 'enable',
      reason: 'low tier, every check green, verifier APPROVE',
    });
    // Already on: nothing to do.
    const on = pr({ autoMergeRequest: { mergeMethod: 'MERGE' } });
    expect(decide(on, [tierLow, approve], green).action).toBe('none');
  });

  it('a high tier PR waits for the permit status', () => {
    const waits = decide(pr(), [tierHigh, approve], green);
    expect(waits).toEqual({ action: 'none', reason: waitsForPermit('label area:db') });
    const on = pr({ autoMergeRequest: { mergeMethod: 'MERGE' } });
    expect(decide(on, [tierHigh, approve], green).action).toBe('disable');
    const permit = status('permit', 'success', 'granted');
    expect(decide(pr(), [tierHigh, approve, permit], green)).toEqual({
      action: 'enable',
      reason: 'high tier with a permit, every check green, verifier APPROVE',
    });
  });

  it('a posted low tier on a head touching src/main/db is blocked', () => {
    const db: File[] = [...small, { filename: 'src/main/db/schema.ts', changes: 1 }];
    const r = decide(pr({ changedFiles: 2 }), [tierLow, approve], green, db);
    expect(r).toEqual({
      action: 'none',
      reason: waitsForPermit('src/main/db/** matched src/main/db/schema.ts'),
    });
    // A rename out of a high path is still a change to it.
    const moved: File[] = [
      { filename: 'src/main/x.ts', previous_filename: 'src/main/db/x.ts', changes: 0 },
    ];
    expect(decide(pr(), [tierLow, approve], green, moved).reason).toBe(
      waitsForPermit('src/main/db/** matched src/main/db/x.ts')
    );
  });

  it('a PR changing the tier list, a workflow or the decision script is high tier', () => {
    for (const filename of [
      '.github/risk-tiers.json',
      '.github/workflows/ci.yml',
      'scripts/auto-merge.mjs',
    ]) {
      const r = decide(pr(), [tierLow, approve], green, [{ filename, changes: 1 }]);
      expect(r.action, filename).toBe('none');
      expect(r.reason, filename).toMatch(/^high tier \(.* matched /);
    }
  });

  // devstation-4x42.181: an Electron bump is a few package.json lines and the lockfile; a dependency
  // or runtime upgrade is high by its path, root or nested, whatever its size.
  it('a PR changing a dependency manifest or the runtime pin is high tier', () => {
    for (const [filename, glob] of [
      ['package.json', '**/package.json'],
      ['server/package.json', '**/package.json'],
      ['packages/protocol/package.json', '**/package.json'],
      ['pnpm-lock.yaml', '**/pnpm-lock.yaml'],
      ['pnpm-workspace.yaml', '**/pnpm-workspace.yaml'],
      ['.npmrc', '**/.npmrc'],
      ['.nvmrc', '**/.nvmrc'],
    ]) {
      const r = decide(pr(), [tierLow, approve], green, [{ filename, changes: 1 }]);
      expect(r, filename).toEqual({
        action: 'none',
        reason: waitsForPermit(`${glob} matched ${filename}`),
      });
    }
  });

  it('more than max_changed_lines counted lines is high tier', () => {
    const { max_changed_lines: max } = JSON.parse(readFileSync(TIERS, 'utf8'));
    const lines = (n: number): File[] => [{ filename: 'src/renderer/a.tsx', changes: n }];
    expect(decide(pr(), [tierLow, approve], green, lines(max)).action).toBe('enable');
    // The lockfile's lines are not counted; its path alone makes the PR high (devstation-4x42.181).
    const lock: File[] = [...lines(max), { filename: 'pnpm-lock.yaml', changes: max * 4 }];
    expect(decide(pr({ changedFiles: 2 }), [tierLow, approve], green, lock).reason).toBe(
      waitsForPermit('**/pnpm-lock.yaml matched pnpm-lock.yaml')
    );
    expect(decide(pr(), [tierLow, approve], green, lines(max + 1)).reason).toBe(
      waitsForPermit(`${max + 1} counted lines changed, more than max_changed_lines ${max}`)
    );
  });

  it('a truncated or unreadable file list is high tier', () => {
    expect(decide(pr({ changedFiles: 3001 }), [tierLow, approve], green).reason).toBe(
      waitsForPermit('the file list holds 1 of 3001 changed files')
    );
    expect(decide(pr(), [tierLow, approve], green, null).reason).toBe(
      waitsForPermit('the file list could not be read')
    );
  });

  it('a failed check blocks the merge and turns auto-merge off', () => {
    const red: Run[] = [
      ...green.slice(0, 2),
      { name: 'leak scan', status: 'completed', conclusion: 'failure' },
    ];
    const on = pr({ autoMergeRequest: { mergeMethod: 'MERGE' } });
    expect(decide(pr(), [tierLow, approve], red)).toEqual({
      action: 'none',
      reason: 'check leak scan is failure',
    });
    expect(decide(on, [tierLow, approve], red).action).toBe('disable');
    const changes = status('verifier', 'failure', 'REQUEST_CHANGES, round 1');
    expect(decide(on, [tierLow, changes], green)).toEqual({
      action: 'disable',
      reason: 'verifier is failure: REQUEST_CHANGES, round 1',
    });
    expect(decide(pr({ isDraft: true }), [tierLow, approve], green).action).toBe('none');
    expect(decide(pr({ baseRefName: 'release' }), [tierLow, approve], green).reason).toBe(
      'the PR merges into release, not main'
    );
    const moved = pr({ headRefOid: 'b'.repeat(40) });
    expect(decide(moved, [tierLow, approve], green).reason).toMatch(/^the PR head moved/);
  });

  it('waits while a check runs or a status is missing', () => {
    const running: Run[] = [
      ...green.slice(0, 2),
      { name: 'leak scan', status: 'in_progress', conclusion: null },
    ];
    expect(decide(pr(), [tierLow, approve], running)).toEqual({
      action: 'none',
      reason: 'check leak scan is in_progress',
    });
    // A running check keeps auto-merge as it is: GitHub merges nothing without its checks.
    const on = pr({ autoMergeRequest: { mergeMethod: 'MERGE' } });
    expect(decide(on, [tierLow, approve], running).action).toBe('none');
    expect(decide(pr(), [approve], green).reason).toBe('no risk-tier status on the head yet');
    expect(decide(pr(), [tierLow], green).reason).toBe('no verifier status on the head yet');
    expect(decide(pr(), [tierLow, approve], green.slice(3)).reason).toBe(
      'no check run on the head yet'
    );
    const odd = spawnSync(process.execPath, [SCRIPT, '--sha', SHA], { encoding: 'utf8' });
    expect(odd.status).toBe(2);
  });

  // A glob that matches nothing guards nothing: the .56 decision's auth* globs matched no file.
  it('every high path of the tier list matches a tracked file', () => {
    const { high_paths: highPaths } = JSON.parse(readFileSync(TIERS, 'utf8')) as {
      high_paths: string[];
    };
    const app = join(SCRIPTS, '..');
    const listed = spawnSync('git', ['ls-files'], { cwd: app, encoding: 'utf8' });
    expect(listed.status).toBe(0);
    const tracked = listed.stdout.split('\n').filter(Boolean);
    const regex = (glob: string) =>
      new RegExp(
        `^${glob
          .split(/(\*\*\/|\*\*|\*|\?)/)
          .map((part) =>
            part === '**/'
              ? '(?:.*/)?'
              : part === '**'
                ? '.*'
                : part === '*'
                  ? '[^/]*'
                  : part === '?'
                    ? '[^/]'
                    : part.replace(/[.+^${}()|[\]\\]/g, '\\$&')
          )
          .join('')}$`
      );
    // The patch that brings the tier list and the decision script lists them before their commit.
    const selfListed = ['.github/risk-tiers.json', 'scripts/auto-merge.mjs'];
    const dead = highPaths.filter(
      (glob) =>
        !(selfListed.includes(glob) && existsSync(join(app, glob))) &&
        !tracked.some((p) => regex(glob).test(p))
    );
    expect(dead).toEqual([]);
  });

  it('the workflow decides from the default branch and holds a new head', () => {
    const text = readFileSync(WORKFLOW, 'utf8');
    const triggers = ['status:', 'workflow_run:', 'workflows: [CI]', 'types: [completed]'];
    for (const trigger of [...triggers, 'pull_request_target:', 'types: [synchronize]'])
      expect(text, trigger).toContain(trigger);
    // No PR code runs: the checkout is the default branch's, and nothing names the PR's ref.
    expect(text).not.toMatch(/ref:\s*\$\{\{\s*github\.event\.pull_request/);
    expect(text).not.toContain('pull_request.head.ref');
    expect(text).toContain('node scripts/auto-merge.mjs');
    // The tier list is the default branch's, the files the PR's own, every page of them.
    expect(text).toContain('--tiers .github/risk-tiers.json');
    expect(text).toContain('gh api --paginate "repos/$REPO/pulls/$pr/files"');
    expect(text).toContain('changedFiles');
    expect(text).toContain('--auto --merge --match-head-commit "$SHA"');
    expect(text).toContain('--disable-auto');
    for (const job of ['auto-merge hold', 'auto-merge decide']) {
      expect(text, job).toContain(`name: ${job}`);
      expect(text, job).toContain(`--ignore-check "${job}"`);
    }
    // devstation-4x42.248: the statuses with their creators, and the App's login trusted.
    expect(text).toContain(`gh api --paginate "repos/$REPO/commits/$SHA/statuses" --jq '.[]'`);
    expect(text).toContain(`--trusted-creator "${TRUSTED}"`);
  });
});

describe('verifier and permit count only from the chord-verifier App (devstation-4x42.248)', () => {
  const tokenApprove = (over: Partial<Status> = {}) => ({
    ...RECORDED.find((s) => s.context === 'verifier')!,
    ...over,
  });

  it('a verifier status the agents token posted is absent', () => {
    // The recorded head as it is: risk-tier low and verifier success, both from xerus-chord-bot.
    expect(RECORDED.map((s) => [s.context, s.state, s.creator.type])).toEqual([
      ['verifier', 'success', 'User'],
      ['risk-tier', 'success', 'User'],
    ]);
    expect(decide(pr(), RECORDED, green)).toEqual({
      action: 'none',
      reason: 'no verifier status on the head yet',
    });
    // With the App's verdict the head is judged: its posted tier was high, so it waits for a
    // permit, which the App's opens.
    expect(decide(pr(), [...RECORDED, approve], green).reason).toBe(
      waitsForPermit('31878 counted lines changed, more than max_changed_lines 300')
    );
    const permit = status('permit', 'success', 'granted');
    expect(decide(pr(), [...RECORDED, approve, permit], green).action).toBe('enable');
  });

  it('a forged success posted after the App verdict leaves the App verdict standing', () => {
    const changes = status('verifier', 'failure', 'REQUEST_CHANGES, round 1');
    const forged = tokenApprove({ id: ++nextId });
    const on = pr({ autoMergeRequest: { mergeMethod: 'MERGE' } });
    expect(decide(on, [tierLow, changes, forged], green)).toEqual({
      action: 'disable',
      reason: 'verifier is failure: REQUEST_CHANGES, round 1',
    });
    // A creator that only looks like the App (another login, or none) is not it.
    const lookalike = status('verifier', 'success', 'APPROVE', {
      ...APP_USER,
      login: 'chord-verifier',
    });
    const anonymous = { ...approve, id: ++nextId, creator: null };
    expect(decide(pr(), [tierLow, lookalike, anonymous], green).reason).toBe(
      'no verifier status on the head yet'
    );
  });

  it('the newest App status of a context decides, whatever the list order', () => {
    const first = status('verifier', 'failure', 'REQUEST_CHANGES, round 1');
    const second = status('verifier', 'success', 'APPROVE, round 2');
    expect(decide(pr(), [second, tierLow, first], green).action).toBe('enable');
  });

  it('a permit the agents token posted does not open a high tier', () => {
    const forgedPermit = status('permit', 'success', 'granted', TOKEN_USER);
    expect(decide(pr(), [tierHigh, approve, forgedPermit], green)).toEqual({
      action: 'none',
      reason: waitsForPermit('label area:db'),
    });
    const appPermit = status('permit', 'success', 'granted');
    expect(decide(pr(), [tierHigh, approve, appPermit], green).action).toBe('enable');
  });

  it('refuses to decide without the trusted creator or from a status it cannot read', () => {
    const none = run(pr(), [tierLow, approve], green, small, []);
    expect(none.status).toBe(2);
    expect(none.stderr).toContain('--trusted-creator');
    const noId = { ...approve, id: undefined };
    const bad = run(pr(), [tierLow, noId], green, small, ['--trusted-creator', TRUSTED]);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain('a status without context, state or id');
  });
});
