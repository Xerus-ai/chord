import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// devstation-4x42.265: verifier.yml posts the required `verifier` status as the chord-verifier App.
// Its safety is in the workflow text (which tree runs, which secrets reach which step), so the text
// is what these assertions hold.
const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = join(app, '.github', 'workflows', 'verifier.yml');
const text = readFileSync(WORKFLOW, 'utf8');

function step(name: string): string {
  const start = text.indexOf(`- name: ${name}`);
  expect(start, name).toBeGreaterThan(-1);
  const next = text.indexOf('\n      - ', start + 1);
  return next === -1 ? text.slice(start) : text.slice(start, next);
}

describe('the verifier workflow (devstation-4x42.265)', () => {
  it('runs main’s definition and reaches its secrets only through the main-only environment', () => {
    expect(text).toMatch(/^on:\n {2}pull_request_target:/m);
    expect(text).not.toMatch(/^\s+pull_request:/m);
    expect(text.match(/^ {4}environment: verifier$/gm)).toHaveLength(2);
    // A fork's PR is never reviewed with the secrets.
    expect(text).toContain('github.event.pull_request.head.repo.full_name == github.repository');
    // The workflow's checkout is main's; the PR head is fetched by sha into its own folder.
    expect(text).not.toMatch(/ref:\s*\$\{\{\s*github\.event\.pull_request/);
    expect(text).not.toContain('pull_request.head.ref');
  });

  it('installs the CLI before the PR head is on disk, with no secret in the step', () => {
    const install = step('Install the Claude CLI');
    expect(install).toContain('working-directory: ${{ runner.temp }}');
    expect(install).toContain('npm install -g @anthropic-ai/claude-code@');
    expect(install).not.toContain('secrets.');
    expect(text.indexOf('- name: Install the Claude CLI')).toBeLessThan(
      text.indexOf('git init -q pr')
    );
    expect(text.match(/npm install/g)).toHaveLength(1);
  });

  it('reviews the diff of the head it posts on, never running the PR’s files', () => {
    const fetch = step('The PR head as files to read, and its diff as data');
    expect(fetch).toContain('core.hooksPath=/dev/null');
    expect(fetch).toContain('compare/$BASE...$HEAD');
    expect(fetch).not.toContain('gh pr diff');
    expect(fetch).not.toContain('secrets.');
    const review = step("Review the diff (harness.json verifier.cmd's limits)");
    expect(review).toContain('--tools Read,Grep,Glob');
    expect(review).toContain('--setting-sources ""');
    expect(review).toContain('--strict-mcp-config');
    expect(review).toContain('--system-prompt "$(cat ../base/.github/verifier/system-prompt.md)"');
    expect(review).toContain(
      '--append-system-prompt "$(cat ../base/.github/verifier/ci-context.md)"'
    );
    expect(text).toContain('node base/scripts/verifier-verdict.mjs');
  });

  it('posts as the App, and error when the review gave no verdict', () => {
    const post = text.slice(text.indexOf('  post:'));
    expect(post).toContain('actions/create-github-app-token@');
    expect(post).toContain('permission-statuses: write');
    expect(post).toContain('GH_TOKEN: ${{ steps.app.outputs.token }}');
    expect(post).toContain("STATE: ${{ needs.review.outputs.state || 'error' }}");
    expect(post).toContain('context=verifier');
    expect(post).toContain('HEAD: ${{ github.event.pull_request.head.sha }}');
  });
});
