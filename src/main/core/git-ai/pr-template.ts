import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PullRequestTemplate } from '@shared/git-ai';

/** Where GitHub reads a single PR template, in its order. */
const TEMPLATE_DIRS = ['.github', '', 'docs'];
const TEMPLATE_NAME = 'pull_request_template.md';

async function findTemplateFile(checkout: string, dir: string): Promise<string | null> {
  let entries;
  try {
    entries = await readdir(path.join(checkout, dir), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const match = entries.find(
    (entry) => entry.isFile() && entry.name.toLowerCase() === TEMPLATE_NAME
  );
  return match ? match.name : null;
}

/**
 * The repository's PR template in the lane's checkout: `.github/`, the root,
 * then `docs/`, any case of `pull_request_template.md` (GitHub's rule). A
 * `PULL_REQUEST_TEMPLATE/` folder of several is picked per PR on GitHub with a
 * query parameter, so none of them is "the" template. Empty means none.
 */
export async function readPullRequestTemplate(
  checkout: string
): Promise<PullRequestTemplate | null> {
  for (const dir of TEMPLATE_DIRS) {
    const name = await findTemplateFile(checkout, dir);
    if (!name) continue;
    const relative = dir ? `${dir}/${name}` : name;
    const text = await readFile(path.join(checkout, relative), 'utf8');
    if (text.trim()) return { path: relative, text };
  }
  return null;
}
