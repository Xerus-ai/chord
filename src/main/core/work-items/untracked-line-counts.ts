import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 10_000;
const LIST_MAX_BUFFER = 32 * 1024 * 1024;
// git's own test for "binary": a NUL in the first 8000 bytes.
const BINARY_SNIFF_BYTES = 8000;

export interface UntrackedLineCount {
  name: string;
  added: number;
}

/** git's own test for a binary file: a NUL among its first bytes. */
export function isBinaryContent(content: Buffer): boolean {
  return content.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

/**
 * Lines git would count as added for a new file: a last line without a
 * newline still counts, and a binary counts none.
 */
export function countAddedLines(content: Buffer): number {
  if (isBinaryContent(content) || content.length === 0) return 0;
  let lines = 0;
  for (const byte of content) if (byte === 0x0a) lines += 1;
  return content[content.length - 1] === 0x0a ? lines : lines + 1;
}

/**
 * Every untracked, not-ignored file under `repoPath` (each file of a new
 * folder, not the folder) with the lines it adds — what `git diff --numstat`
 * reports for it once added, binaries as 0. `git diff` never sees untracked
 * files, so without this a new file read as +0 in the Changes tab and an item
 * whose only change was new files showed no +/− in the sidebar
 * (devstation-ui4). A file deleted between the listing and its read is no
 * longer a change and is left out; any other failure throws.
 */
export async function readUntrackedLineCounts(repoPath: string): Promise<UntrackedLineCount[]> {
  const { stdout } = await execFileAsync(
    GIT_EXECUTABLE,
    ['ls-files', '--others', '--exclude-standard', '-z'],
    { cwd: repoPath, timeout: GIT_TIMEOUT_MS, maxBuffer: LIST_MAX_BUFFER }
  );
  const names = stdout.split('\0').filter(Boolean);

  const counts = await Promise.all(
    names.map(async (name): Promise<UntrackedLineCount | null> => {
      try {
        return { name, added: countAddedLines(await readFile(resolve(repoPath, name))) };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    })
  );
  return counts.filter((count): count is UntrackedLineCount => count !== null);
}
