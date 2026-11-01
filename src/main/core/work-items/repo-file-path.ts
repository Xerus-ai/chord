import { stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { err, ok, type Result } from '@shared/result';

/**
 * A repo-relative path resolved inside one checkout, or null when it would
 * leave it (`..`, an absolute path elsewhere) or names the checkout itself.
 * Paths arrive from tabs and rendered agent output, so every read, write and
 * preview of a repo file goes through here.
 */
export function confineToCheckout(checkoutPath: string, filePath: string): string | null {
  const root = resolve(checkoutPath);
  const absolute = resolve(root, filePath);
  if (!absolute.startsWith(root + sep)) return null;
  // Spelled from the caller's checkout path, as every other path under it is.
  return join(checkoutPath, relative(root, absolute));
}

export type WriteRepoFileError =
  | { type: 'outside_repo' }
  | { type: 'not_found' }
  | { type: 'write_error'; message: string };

/**
 * Edit mode's save (design 2026-09-26 §3): rewrites a file that exists in the
 * checkout. It never creates one — a tab only edits a file it opened.
 */
export async function writeRepoFileAt(
  checkoutPath: string,
  filePath: string,
  content: string
): Promise<Result<void, WriteRepoFileError>> {
  const absolute = confineToCheckout(checkoutPath, filePath);
  if (absolute === null) return err({ type: 'outside_repo' });
  try {
    const stats = await stat(absolute);
    if (!stats.isFile()) return err({ type: 'not_found' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return err({ type: 'not_found' });
    return err({ type: 'write_error', message: String(error) });
  }
  try {
    await writeFile(absolute, content, 'utf-8');
    return ok();
  } catch (error) {
    return err({ type: 'write_error', message: String(error) });
  }
}
