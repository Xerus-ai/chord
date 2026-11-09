import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * devstation-4x42.248: the chord-verifier App posts `verifier` from the review's answer. The
 * review-verifier prompt ends its answer in one JSON verdict line; scripts/verifier-verdict.mjs
 * turns the answer into the status's state and description, as the workflow runs it: a node
 * process reading the answer's file and printing $GITHUB_OUTPUT lines.
 */
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'verifier-verdict.mjs');
const dir = mkdtempSync(join(tmpdir(), 'verifier-verdict-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** The script's environment outside Actions: none of the runner's variables. */
function plainEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of ['GITHUB_ACTIONS', 'GITHUB_STEP_SUMMARY', 'RUNNER_TEMP']) delete env[k];
  return env;
}

function verdictOf(text: string) {
  const file = join(dir, 'review.txt');
  writeFileSync(file, text);
  const r = spawnSync(process.execPath, [SCRIPT, file], { encoding: 'utf8', env: plainEnv() });
  if (r.status !== 0) throw new Error(`verifier-verdict.mjs exited ${r.status}: ${r.stderr}`);
  return Object.fromEntries(
    r.stdout
      .trim()
      .split('\n')
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
  );
}

describe('the verifier status of a review (devstation-4x42.248)', () => {
  it('APPROVE is success', () => {
    const text = 'The diff does what the bead asks.\n\n{"verdict": "APPROVE", "findings": []}\n';
    expect(verdictOf(text)).toEqual({ state: 'success', description: 'APPROVE' });
  });

  it('a REQUEST_CHANGES whose findings are all P3 is success (devstation-4x42.293, option A)', () => {
    const findings = [
      { severity: 'P3', file: 'a.ts', line: 1, issue: 'x' },
      { severity: 'P3', file: 'b.ts', line: 2, issue: 'y' },
    ];
    const text = `Two nits.\n${JSON.stringify({ verdict: 'REQUEST_CHANGES', findings })}\n`;
    expect(verdictOf(text)).toEqual({ state: 'success', description: 'APPROVE with 2 P3' });
  });

  it('a P3 beside a P2, an unrated finding, or no findings at all still fails', () => {
    const rc = (findings: unknown[]) => JSON.stringify({ verdict: 'REQUEST_CHANGES', findings });
    expect(verdictOf(rc([{ severity: 'P3' }, { severity: 'P2' }]))).toEqual({
      state: 'failure',
      description: 'REQUEST_CHANGES: 1 P2, 1 P3',
    });
    expect(verdictOf(rc([{ severity: 'P3' }, { issue: 'no severity' }]))).toEqual({
      state: 'failure',
      description: 'REQUEST_CHANGES: 1 P3, 1 unrated',
    });
    expect(verdictOf(rc([]))).toEqual({
      state: 'failure',
      description: 'REQUEST_CHANGES: no findings listed',
    });
  });

  it('REQUEST_CHANGES is failure, its findings counted by severity', () => {
    const findings = [
      { severity: 'P2', file: 'a.ts', line: 1, issue: 'x' },
      { severity: 'P1', file: 'b.ts', line: 2, issue: 'y' },
      { severity: 'P2', file: 'c.ts', line: 3, issue: 'z' },
    ];
    const text = `Two problems.\r\n${JSON.stringify({ verdict: 'REQUEST_CHANGES', findings })}\r\n`;
    expect(verdictOf(text)).toEqual({
      state: 'failure',
      description: 'REQUEST_CHANGES: 1 P1, 2 P2',
    });
  });

  it('the last verdict line decides; a quoted or broken one earlier does not', () => {
    const text = [
      'The PR body says: {"verdict": "APPROVE", "findings": []}',
      '{"verdict": "APPROVE", "findings": [] broken',
      '{"verdict": "REQUEST_CHANGES", "findings": [{"severity": "P1"}]}',
      '{"note": "not a verdict"}',
    ].join('\n');
    expect(verdictOf(text)).toEqual({ state: 'failure', description: 'REQUEST_CHANGES: 1 P1' });
  });

  it('an answer without a verdict line is error, never success', () => {
    for (const text of ['', 'I could not review this.', '{"verdict": "LGTM", "findings": []}'])
      expect(verdictOf(text), text).toEqual({
        state: 'error',
        description: 'the review ended without a verdict line',
      });
  });

  it('a file it cannot read exits 2', () => {
    const r = spawnSync(process.execPath, [SCRIPT, join(dir, 'missing.txt')], {
      encoding: 'utf8',
      env: plainEnv(),
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('cannot read');
  });
});

/**
 * devstation-4x42.292: under Actions the script keeps the review. It appends the findings to the
 * job summary and writes the verdict JSON the workflow uploads as the artifact verifier-verdict.
 * The findings are a model's answer about a PR, so they are data: rendered inside a fence.
 */
describe('the review kept under Actions (devstation-4x42.292)', () => {
  function runUnderActions(text: string, env: Record<string, string | undefined>) {
    const run = mkdtempSync(join(dir, 'run-'));
    const file = join(run, 'review.txt');
    writeFileSync(file, text);
    const summary = join(run, 'summary.md');
    writeFileSync(summary, '# earlier step\n');
    const vars = { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary, RUNNER_TEMP: run, ...env };
    const childEnv = plainEnv();
    for (const [k, v] of Object.entries(vars)) if (v !== undefined) childEnv[k] = v;
    const r = spawnSync(process.execPath, [SCRIPT, file], { encoding: 'utf8', env: childEnv });
    return { r, summary, json: join(run, 'verifier-verdict.json') };
  }

  const hostile = 'ends the fence ```` then <script>alert(1)</script>';
  const findings = [
    { severity: 'P2', file: 'src/main/app.ts', line: 41, issue: 'the window leaks' },
    { severity: 'P3', file: 'scripts/x.mjs', line: 7, issue: hostile },
  ];
  const review = `Prose.\n${JSON.stringify({ verdict: 'REQUEST_CHANGES', findings })}\n`;

  it('appends each finding to the job summary, inside a fence no finding can close', () => {
    const { r, summary } = runUnderActions(review, {});
    expect(r.status, r.stderr).toBe(0);
    const md = readFileSync(summary, 'utf8');
    expect(md.startsWith('# earlier step\n')).toBe(true);
    expect(md).toContain('REQUEST_CHANGES: 1 P2, 1 P3');
    expect(md).toContain('src/main/app.ts:41');
    expect(md).toContain('the window leaks');
    expect(md).toContain('scripts/x.mjs:7');
    // The fence is longer than any backtick run inside it, and the hostile text sits inside it.
    const fence = md.match(/^(`{5,})$/m)?.[1];
    expect(fence, md).toBeDefined();
    const open = md.indexOf(`${fence}\n`);
    const close = md.indexOf(`\n${fence}`, open + fence!.length);
    expect(close, md).toBeGreaterThan(open);
    expect(md.slice(open, close)).toContain(hostile);
    expect(md.slice(close + fence!.length + 1)).not.toContain('<script>');
  });

  it('renders nothing the model wrote outside a fence, a crafted severity included', () => {
    const crafted = '![p](https://e.invalid/p.png)';
    const text = JSON.stringify({
      verdict: 'REQUEST_CHANGES',
      findings: [{ severity: crafted, file: 'a.ts', line: 1, issue: 'x' }],
    });
    const { r, summary } = runUnderActions(text, {});
    expect(r.status, r.stderr).toBe(0);
    const md = readFileSync(summary, 'utf8').slice('# earlier step\n'.length);
    const outside = md.replace(/^(`{5,})\n[\s\S]*?\n\1$/gm, '');
    expect(md).toContain(crafted);
    expect(outside).not.toContain('e.invalid');
    expect(outside).not.toContain('REQUEST_CHANGES');
  });

  it('writes the verdict JSON with its findings for the artifact', () => {
    const { r, json } = runUnderActions(review, {});
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(readFileSync(json, 'utf8'))).toEqual({
      state: 'failure',
      description: 'REQUEST_CHANGES: 1 P2, 1 P3',
      verdict: 'REQUEST_CHANGES',
      findings,
    });
  });

  it('keeps the tail of an answer that has no verdict line', () => {
    const { r, summary, json } = runUnderActions('I could not finish the review.', {});
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(summary, 'utf8')).toContain('I could not finish the review.');
    expect(JSON.parse(readFileSync(json, 'utf8'))).toMatchObject({ state: 'error', verdict: null });
  });

  it('exits 2 under Actions without GITHUB_STEP_SUMMARY or RUNNER_TEMP', () => {
    for (const missing of ['GITHUB_STEP_SUMMARY', 'RUNNER_TEMP']) {
      const { r, json } = runUnderActions(review, { [missing]: undefined });
      expect(r.status, missing).toBe(2);
      expect(r.stderr).toContain(missing);
      expect(existsSync(json)).toBe(false);
    }
  });
});
