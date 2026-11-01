import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { SoloLeftovers } from '@shared/solo';
import { listUntrackedFiles, removeFileAndEmptyParents } from './solo-git';

export function soloLeftoversRoot(gitDir: string): string {
  return path.join(gitDir, 'chord-solo-leftovers');
}

function isUnder(file: string, ignoredEntry: string): boolean {
  return ignoredEntry.endsWith('/') ? file.startsWith(ignoredEntry) : file === ignoredEntry;
}

/**
 * Moves the run output a lane's rules ignored and the root's own branch does
 * not out of a root just returned to its branch. `ignoredWhileHeld` is
 * `listIgnoredEntries` taken while the root still had the lane's rules. The
 * root was clean when Solo began, so an untracked, non-ignored file now that
 * was ignored then can only be what the run wrote. It goes — copied with its
 * timestamps, then removed from the root — to
 * `<git dir>/chord-solo-leftovers/<timestamp>/` under its relative path:
 * never deleted, never left to make the root dirty. Null when there is none.
 */
export async function moveRunLeftovers(
  rootPath: string,
  gitDir: string,
  ignoredWhileHeld: string[]
): Promise<SoloLeftovers | null> {
  const files = (await listUntrackedFiles(rootPath)).filter((file) =>
    ignoredWhileHeld.some((entry) => isUnder(file, entry))
  );
  if (files.length === 0) return null;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(soloLeftoversRoot(gitDir), stamp);
  for (const file of files) {
    const destination = path.join(dir, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(rootPath, file), destination, {
      preserveTimestamps: true,
      verbatimSymlinks: true,
    });
    await removeFileAndEmptyParents(rootPath, file);
  }
  return { dir, files };
}
