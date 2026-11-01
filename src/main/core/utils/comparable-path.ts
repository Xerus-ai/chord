import path from 'node:path';

/**
 * Windows paths are case-insensitive; two spellings of one folder must match.
 * `platform` is the one the paths belong to, this host by default: a path
 * recorded on Windows compares as Windows wherever it is read.
 */
export function comparablePath(
  folder: string,
  platform: NodeJS.Platform = process.platform
): string {
  if (platform === 'win32') return path.win32.resolve(folder).toLowerCase();
  return path.posix.resolve(folder);
}
