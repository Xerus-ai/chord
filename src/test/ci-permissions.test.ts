import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * CI's GITHUB_TOKEN gets only what its steps use (devstation-i3y5.3). Without a `permissions:`
 * block the token gets the repository default on push to main, while steps run `pnpm install`
 * lifecycle scripts. Every CI step reads the repository at most (checkout, the pnpm cache and the
 * artifact upload use the runner's own token), so the workflow grants `contents: read` and no job
 * asks for more. ci.yml is read as text: a top-level key starts at column 0, a job at two spaces.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ci = readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8').replace(/\r/g, '');

/** The `key: value` lines of an indented block that starts with `header` at the given indent. */
function block(text: string, indent: string, header: string): string[] | null {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === `${indent}${header}`);
  if (start < 0) return null;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    if (!line.startsWith(`${indent}  `)) break;
    body.push(line.trim());
  }
  return body;
}

describe('ci.yml GITHUB_TOKEN permissions', () => {
  it('grants contents read at the top level', () => {
    expect(block(ci, '', 'permissions:')).toEqual(['contents: read']);
  });

  it('no job widens the token', () => {
    const jobs = ci.slice(ci.indexOf('\njobs:\n'));
    expect(jobs).not.toMatch(/^\s+permissions:\s*write-all/m);
    const jobBlocks = [...jobs.matchAll(/^( {4,})permissions:\s*$/gm)].map((m) => block(jobs, m[1], 'permissions:') ?? []);
    for (const scopes of jobBlocks) {
      for (const scope of scopes) expect(scope).toMatch(/:\s*(read|none)$/);
    }
    expect(ci).not.toMatch(/:\s*write\s*$/m);
  });
});
