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

type Status = { context: string; state: string; description: string };
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
const status = (context: string, state: string, description: string): Status => ({
  context,
  state,
  description,
});
const tierLow = status('risk-tier', 'success', 'low');
const tierHigh = status('risk-tier', 'success', 'high: label area:db');
const approve = status('verifier', 'success', 'APPROVE, round 1');
const green: Run[] = [
  { name: 'lint, typecheck, test (Linux)', status: 'completed', conclusion: 'success' },
  { name: 'build (Windows)', status: 'completed', conclusion: 'success' },
  { name: 'leak scan', status: 'completed', conclusion: 'success' },
  { name: 'auto-merge decide', status: 'in_progress', conclusion: null },
];
const small: File[] = [{ filename: 'src/main/core/lanes/lane.ts', changes: 12 }];

/** files: the PR's file list as the workflow writes it (one JSON object a line); null: gh gave none. */
function decide(p: object, statuses: Status[], runs: Run[], files: File[] | null = small) {
  writeFileSync(join(dir, 'pr.json'), JSON.stringify(p));
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ state: 'success', sha: SHA, statuses }));
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
    ['--status', 'status.json'],
    ['--checks', 'checks.json'],
  ])
    args.push(flag, join(dir, file));
  args.push('--tier-context', 'risk-tier', '--verifier-context', 'verifier');
  args.push('--permit-context', 'permit');
  args.push('--ignore-check', 'auto-merge hold', '--ignore-check', 'auto-merge decide');
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
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

  it('more than max_changed_lines counted lines is high tier', () => {
    const { max_changed_lines: max } = JSON.parse(readFileSync(TIERS, 'utf8'));
    const lines = (n: number): File[] => [{ filename: 'src/renderer/a.tsx', changes: n }];
    expect(decide(pr(), [tierLow, approve], green, lines(max)).action).toBe('enable');
    // The lockfile is not counted.
    const lock: File[] = [...lines(max), { filename: 'pnpm-lock.yaml', changes: max * 4 }];
    expect(decide(pr({ changedFiles: 2 }), [tierLow, approve], green, lock).action).toBe('enable');
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
  });
});
