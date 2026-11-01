import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { IExecutionContext } from '@main/core/execution-context/types';

/**
 * Hides a file Chord keeps in a checkout from `git status` through the
 * repository's own `info/exclude` — never the user's tracked `.gitignore`.
 * `--git-path` resolves to the common directory from a linked worktree, so
 * one entry covers every lane of the repository.
 */
export async function excludeFromGit(
  git: IExecutionContext,
  cwd: string,
  checkoutPath: string
): Promise<void> {
  const { stdout } = await git.exec('git', ['rev-parse', '--git-path', 'info/exclude']);
  const excludeFile = resolve(cwd, stdout.trim());
  const entry = `/${checkoutPath}`;
  const existing = existsSync(excludeFile) ? await readFile(excludeFile, 'utf-8') : '';
  if (existing.split(/\r?\n/).some((line) => line.trim() === entry)) return;

  await mkdir(dirname(excludeFile), { recursive: true });
  const prefix = existing.length === 0 || existing.endsWith('\n') ? existing : `${existing}\n`;
  await writeFile(excludeFile, `${prefix}${entry}\n`);
}
