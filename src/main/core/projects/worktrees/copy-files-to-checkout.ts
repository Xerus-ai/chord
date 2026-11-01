import { promises as fs } from 'node:fs';
import path from 'node:path';
import { glob } from 'glob';
import { err, ok, type Result } from '@shared/result';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';

/**
 * Copies a repository's "files to copy" (`.env` and friends) from the main
 * checkout into a new checkout.
 *
 * Only gitignored files qualify. A tracked file is already in the checkout at
 * the lane's own commit; copying the main checkout's version over it would
 * silently put someone else's uncommitted edit into the lane. Matches must
 * also resolve inside the repository — a pattern is repository content, and
 * `../` must not reach the rest of the disk.
 *
 * The copy is all-or-nothing against a cap, so a pattern like `**` over a
 * `node_modules` never fills the disk halfway before failing.
 */

export const FILES_TO_COPY_LIMITS = { maxFiles: 20_000, maxBytes: 500 * 1024 * 1024 };

export type CopyFilesLimits = { maxFiles: number; maxBytes: number };

export type CopyFilesError = {
  type: 'limit_exceeded';
  files: number;
  bytes: number;
  limits: CopyFilesLimits;
  message: string;
};

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.lstat(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

const CHECK_IGNORE_BATCH = 200;

const toGitPath = (p: string) => p.split(path.sep).join('/');

/** Which of `relPaths` git ignores. Tracked files are never reported as ignored. */
async function filterIgnored(repoPath: string, relPaths: string[]): Promise<string[]> {
  const ctx = new LocalExecutionContext({ root: repoPath });
  const ignored = new Set<string>();
  for (let i = 0; i < relPaths.length; i += CHECK_IGNORE_BATCH) {
    const batch = relPaths.slice(i, i + CHECK_IGNORE_BATCH).map(toGitPath);
    // Exit code 1 means "none of these are ignored" — an answer, not a failure.
    const { stdout } = await ctx
      .exec(GIT_EXECUTABLE, ['check-ignore', '--', ...batch])
      .catch((error: { code?: number }) => {
        if (error.code === 1) return { stdout: '' };
        throw error;
      });
    for (const line of stdout.split('\n')) {
      if (line.trim()) ignored.add(line.trim());
    }
  }
  return relPaths.filter((p) => ignored.has(toGitPath(p)));
}

export async function copyFilesToCheckout(args: {
  repoPath: string;
  checkoutPath: string;
  patterns: string[];
  limits?: CopyFilesLimits;
  /** Leave a file the checkout already has as it is (an adopted checkout is the user's). */
  keepExisting?: boolean;
}): Promise<Result<{ copied: string[]; kept: string[] }, CopyFilesError>> {
  const limits = args.limits ?? FILES_TO_COPY_LIMITS;
  const repoRoot = path.resolve(args.repoPath);

  const matched = new Set<string>();
  for (const pattern of args.patterns) {
    const hits = await glob(pattern, {
      cwd: repoRoot,
      dot: true,
      nodir: true,
      ignore: ['.git/**', '**/.git/**'],
    });
    for (const hit of hits) {
      if (isInside(repoRoot, path.resolve(repoRoot, hit))) matched.add(path.normalize(hit));
    }
  }

  const candidates = await filterIgnored(repoRoot, [...matched]);

  let bytes = 0;
  for (const relPath of candidates) {
    bytes += (await fs.stat(path.join(repoRoot, relPath))).size;
  }
  if (candidates.length > limits.maxFiles || bytes > limits.maxBytes) {
    return err({
      type: 'limit_exceeded',
      files: candidates.length,
      bytes,
      limits,
      message: `Files to copy matched ${candidates.length} files (${bytes} bytes); the limit is ${limits.maxFiles} files and ${limits.maxBytes} bytes. Narrow the patterns in .chord.json.`,
    });
  }

  const copied: string[] = [];
  const kept: string[] = [];
  for (const relPath of candidates) {
    const dest = path.join(args.checkoutPath, relPath);
    if (args.keepExisting && (await pathExists(dest))) {
      kept.push(toGitPath(relPath));
      continue;
    }
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(path.join(repoRoot, relPath), dest);
    copied.push(toGitPath(relPath));
  }
  return ok({ copied, kept });
}
