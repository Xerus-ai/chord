import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

function verdictOf(text: string) {
  const file = join(dir, 'review.txt');
  writeFileSync(file, text);
  const r = spawnSync(process.execPath, [SCRIPT, file], { encoding: 'utf8' });
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
    const r = spawnSync(process.execPath, [SCRIPT, join(dir, 'missing.txt')], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('cannot read');
  });
});
