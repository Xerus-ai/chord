import { isAbsolute, relative, sep } from 'node:path';

/**
 * A file's path relative to the repo checkout, spelled with forward slashes as
 * the repo file list spells it — how an artifact's tab and the Files tab find
 * each other (design 2026-09-26 §3). Null for a file outside the repo (a plan
 * stored in the profile), for the repo directory itself, or without either.
 */
export function toRepoRelativePath(
  filePath: string | null,
  repoPath: string | null
): string | null {
  if (!filePath || !repoPath) return null;
  const rel = relative(repoPath, filePath);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return rel.split(sep).join('/');
}
