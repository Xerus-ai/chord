import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readPullRequestTemplate } from './pr-template';

let checkout: string;

function write(relativePath: string, text: string): void {
  const file = path.join(checkout, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/**
 * The repository's PR template, from the places GitHub reads a single one:
 * `.github/`, the root, then `docs/` — any case of `pull_request_template.md`.
 * A `PULL_REQUEST_TEMPLATE/` folder of several is chosen per PR on GitHub with
 * a query parameter, so none of them is "the" template.
 */
describe('readPullRequestTemplate', () => {
  beforeEach(() => {
    checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'chord-git-ai-template-'));
  });

  afterEach(() => {
    fs.rmSync(checkout, { recursive: true, force: true });
  });

  it('reads .github/pull_request_template.md', async () => {
    write('.github/pull_request_template.md', '## Summary\n');
    expect(await readPullRequestTemplate(checkout)).toEqual({
      path: '.github/pull_request_template.md',
      text: '## Summary\n',
    });
  });

  it('reads the root and docs/ locations', async () => {
    write('docs/pull_request_template.md', '## From docs\n');
    expect((await readPullRequestTemplate(checkout))?.path).toBe('docs/pull_request_template.md');

    write('pull_request_template.md', '## From root\n');
    expect((await readPullRequestTemplate(checkout))?.text).toBe('## From root\n');
  });

  it('prefers .github/ over the root and docs/', async () => {
    write('docs/pull_request_template.md', '## docs\n');
    write('pull_request_template.md', '## root\n');
    write('.github/pull_request_template.md', '## github\n');
    expect((await readPullRequestTemplate(checkout))?.text).toBe('## github\n');
  });

  it('matches the file name in any case, as GitHub does', async () => {
    write('.github/PULL_REQUEST_TEMPLATE.md', '## Upper\n');
    expect(await readPullRequestTemplate(checkout)).toEqual({
      path: '.github/PULL_REQUEST_TEMPLATE.md',
      text: '## Upper\n',
    });
  });

  it('has none for a folder of several templates only, an empty file, or no file', async () => {
    expect(await readPullRequestTemplate(checkout)).toBeNull();

    write('.github/PULL_REQUEST_TEMPLATE/feature.md', '## Feature\n');
    write('.github/PULL_REQUEST_TEMPLATE/bug.md', '## Bug\n');
    expect(await readPullRequestTemplate(checkout)).toBeNull();

    write('pull_request_template.md', '  \n');
    expect(await readPullRequestTemplate(checkout)).toBeNull();
  });
});
