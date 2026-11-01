import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { join } from 'node:path';

export type PathLookupEnv = {
  /** The PATH value to search, in the platform's own list format. */
  path: string | undefined;
  /** PATHEXT on Windows: the extensions a bare command name runs with. */
  pathExt: string | undefined;
  platform: NodeJS.Platform;
};

/** `path` is a file this process may run: on POSIX also executable, as `which` requires. */
async function isRunnableFile(path: string, windows: boolean): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) return false;
    if (!windows) await access(path, constants.X_OK);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // A PATH entry that does not exist, is not a directory or may not be
    // read holds nothing this process can run; nor does a file without the
    // execute bit.
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES' || code === 'EPERM') {
      return false;
    }
    throw error;
  }
}

/** Extensions Windows runs a command with (`.exe`, `.cmd`, …), lowercased, in PATHEXT order. */
function runnableExtensions(pathExt: string | undefined): string[] {
  if (!pathExt) throw new Error('PATHEXT is not set; cannot tell which files Windows can run');
  return pathExt
    .toLowerCase()
    .split(';')
    .filter((ext) => ext.length > 0);
}

/**
 * The file names `command` runs as on Windows: itself when it already names a
 * runnable extension, else itself with each PATHEXT extension. Never the bare
 * extensionless name — npm installs a CLI as an extensionless shell script
 * beside its `.cmd`, and Windows cannot start that script.
 */
function windowsCandidates(command: string, pathExt: string | undefined): string[] {
  const extensions = runnableExtensions(pathExt);
  const lower = command.toLowerCase();
  if (extensions.some((ext) => lower.endsWith(ext))) return [command];
  return extensions.map((ext) => command + ext);
}

/**
 * The absolute path a shell would run for `command`, read from PATH in this
 * process: the first PATH directory holding a match wins; on Windows, PATHEXT
 * order decides between matches in one directory. Returns null when no PATH
 * directory has it.
 *
 * Replaces spawning `where` / `which` for local commands: process creation is
 * synchronous on the main thread on Windows (~25ms each), and the dependency
 * probes resolved nine commands that way at boot, before the window existed.
 * Unlike `where`, the main process's working directory is not searched — it is
 * wherever the app was started from, not a place a dependency lives.
 */
export async function findCommandOnPath(
  command: string,
  env: PathLookupEnv
): Promise<string | null> {
  const windows = env.platform === 'win32';
  const names = windows ? windowsCandidates(command, env.pathExt) : [command];
  if (env.path === undefined) throw new Error(`PATH is not set; cannot look up ${command}`);
  const dirs = env.path
    .split(windows ? ';' : ':')
    .map((dir) => (windows ? dir.replace(/"/g, '') : dir).trim())
    .filter((dir) => dir.length > 0);
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (await isRunnableFile(candidate, windows)) return candidate;
    }
  }
  return null;
}
