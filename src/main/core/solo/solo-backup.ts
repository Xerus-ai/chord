import type { Stats } from 'node:fs';
import { cp, lstat, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

async function lstatIfPresent(file: string): Promise<Stats | null> {
  try {
    return await lstat(file);
  } catch (error) {
    // Nothing on disk at this path (or a file where a folder would be) is a
    // designed answer here: there is nothing to back up.
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
}

async function listFilesUnder(rootPath: string, relDir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(path.join(rootPath, relDir), { withFileTypes: true })) {
    const rel = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await listFilesUnder(rootPath, rel)));
    else files.push(rel);
  }
  return files;
}

/**
 * The root files a write or delete at `rel` destroys: the file at `rel`, every
 * file under `rel` when it is a folder, and a file standing where one of
 * `rel`'s parent folders has to go.
 */
async function listFilesInTheWay(rootPath: string, rel: string): Promise<string[]> {
  const parts = rel.split('/');
  for (let depth = 1; depth < parts.length; depth++) {
    const ancestor = parts.slice(0, depth).join('/');
    const stats = await lstatIfPresent(path.join(rootPath, ancestor));
    if (stats === null) return [];
    if (!stats.isDirectory()) return [ancestor];
  }
  const stats = await lstatIfPresent(path.join(rootPath, rel));
  if (stats === null) return [];
  return stats.isDirectory() ? listFilesUnder(rootPath, rel) : [rel];
}

/**
 * Copies the original bytes (and timestamps) of every root file that writing
 * or deleting `touchedPaths` would destroy into `backupDir`, keeping relative
 * paths, and returns the paths it backed up. Files in `alreadyBackedUp` are
 * skipped: their first backup holds the original, and the root now holds a
 * copy Solo wrote. Tracked files are included, not only ignored ones: with
 * `core.autocrlf` a clean file's bytes can differ from what git writes for
 * it, so checking the branch out again would not give the original bytes back.
 */
export async function backupRootFiles(
  rootPath: string,
  backupDir: string,
  touchedPaths: string[],
  alreadyBackedUp: ReadonlySet<string>
): Promise<string[]> {
  const files = new Set<string>();
  for (const rel of touchedPaths) {
    for (const file of await listFilesInTheWay(rootPath, rel)) files.add(file);
  }
  const entries = [...files].filter((file) => !alreadyBackedUp.has(file)).sort();
  for (const rel of entries) {
    const destination = path.join(backupDir, rel);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(rootPath, rel), destination, {
      preserveTimestamps: true,
      verbatimSymlinks: true,
    });
  }
  return entries;
}

/** Copies every backed-up file back over the root, recreating its folders. */
export async function restoreRootFiles(
  rootPath: string,
  backupDir: string,
  entries: string[]
): Promise<void> {
  for (const rel of entries) {
    const destination = path.join(rootPath, rel);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(backupDir, rel), destination, {
      force: true,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    });
  }
}
