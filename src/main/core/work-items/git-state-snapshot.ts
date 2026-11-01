import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  GIT_FILE_SIDE_BYTE_CAP,
  GIT_SNAPSHOT_CONTENT_BYTE_BUDGET,
  type CloudGitFileContent,
  type CloudGitFileMeta,
  type CloudGitFileStatus,
  type CloudGitStatePutBody,
} from '@chord/protocol';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { countAddedLines, isBinaryContent } from './untracked-line-counts';

/**
 * What one git-state capture reads from a shared work item's repo and sends
 * (split from git-state-capture.ts): git's porcelain and numstat, parsed, and
 * the snapshot body with each changed file's contents within the byte budgets.
 */

const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER = 10 * 1024 * 1024;

const execFileAsync = promisify(execFile);

/** A shared work item and the repo its capture reads. */
export interface SharedTarget {
  workItemId: string;
  repoPath: string;
}

interface NumstatEntry {
  path: string;
  additions: number;
  deletions: number;
  /** Numstat prints "-" for binary files — their contents are never shipped. */
  binary: boolean;
}

async function runGit(repoPath: string, args: string[]): Promise<string> {
  // Fail-fast by design: any git failure throws to the caller, which pushes
  // NOTHING for that item. Never mirror workItemsController.getGitStatus's
  // ok({files: []})-on-failure shape here — an empty snapshot pushed on error
  // would overwrite the participant's last-known-good state.
  const { stdout } = await execFileAsync(GIT_EXECUTABLE, args, {
    cwd: repoPath,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
  });
  return stdout;
}

function parseNumstat(stdout: string): NumstatEntry[] {
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [added, removed, path] = line.split('\t');
      const binary = added === '-' || removed === '-';
      return {
        path: path ?? '',
        additions: binary ? 0 : parseInt(added ?? '0', 10),
        deletions: binary ? 0 : parseInt(removed ?? '0', 10),
        binary,
      };
    })
    .filter((entry) => entry.path.length > 0);
}

/**
 * Deterministic content fingerprint for one file's pre/post-images.
 * Length-prefixed so no original/modified boundary is ambiguous. Mirrored
 * (not imported — the server is a separate package) in
 * server/src/routes/git-state.ts; keep both sides in the same commit.
 */
function computeContentHash(original: string, modified: string): string {
  return createHash('sha256')
    .update(String(Buffer.byteLength(original, 'utf8')))
    .update('\0')
    .update(original, 'utf8')
    .update('\0')
    .update(String(Buffer.byteLength(modified, 'utf8')))
    .update('\0')
    .update(modified, 'utf8')
    .digest('hex');
}

/** What one capture reads from the repo: its branch, status and diff stats. */
export interface GitStateInputs {
  branch: string;
  porcelain: string;
  numstat: string;
}

/**
 * The three reads a capture fingerprints and builds from. Status is
 * NUL-separated (`-z`), one entry per file: `--untracked-files=all` names each
 * file of a new folder rather than the folder once, which the snapshot then
 * tried to read as a file and failed every capture on (`EISDIR`,
 * devstation-c4t); `-z` keeps a path with a space unquoted; `--no-renames`
 * keeps a rename as a delete and an add, as numstat reports it.
 * core.quotepath=false keeps non-ASCII paths unescaped in numstat, so wire
 * paths stay real filesystem paths usable by `git show` and readFile.
 */
export async function readGitStateInputs(repoPath: string): Promise<GitStateInputs> {
  const branch = (await runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  const porcelain = await runGit(repoPath, [
    'status',
    '--porcelain',
    '-z',
    '--untracked-files=all',
    '--no-renames',
  ]);
  const numstat = await runGit(repoPath, [
    '-c',
    'core.quotepath=false',
    'diff',
    '--numstat',
    '--no-renames',
    'HEAD',
  ]);
  return { branch, porcelain, numstat };
}

/** XY porcelain codes → wire status. Untracked/added → added; any delete → deleted. */
function parsePorcelainStatuses(stdout: string): Map<string, CloudGitFileStatus> {
  const statuses = new Map<string, CloudGitFileStatus>();
  for (const entry of stdout.split('\0')) {
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    const path = entry.slice(3);
    if (xy === '??' || xy.includes('A')) statuses.set(path, 'added');
    else if (xy.includes('D')) statuses.set(path, 'deleted');
    else statuses.set(path, 'modified');
  }
  return statuses;
}

/**
 * Owner-side snapshot capture for the participant Changes tab: a main-process
 * interval running ONLY for shared items (a work-item member, or
 * general_access 'team') — every private local repo's diffs must
 * never reach the cloud. Two-stage change detection keeps the tick cheap:
 * stage 1 hashes `git status --porcelain` + `git diff --numstat` output and
 * skips items whose fingerprint matches the last push; only a change runs the
 * full per-file capture. Git failures push nothing (fail-fast).
 *
 * Within a capture, per-file content is itself delta'd against
 * confirmedContentHash: a file whose (original, modified) hash matches what
 * the server is confirmed to already have is marked content_omitted=false
 * with just its hash, and left out of `contents` — the server keeps its
 * existing row instead of the client re-uploading identical bytes. "Confirmed"
 * is deliberately conservative: a push is promoted from pendingContentHash to
 * confirmedContentHash only once its sync_queue row is gone (see
 * reconcileConfirmedHashes), i.e. actually delivered — never optimistically
 * at enqueue time. enqueueGitState's queue merges same-item pushes by whole-
 * snapshot replace (sync-queue-service.ts), so an in-flight-but-undelivered
 * push can be discarded before it ever reaches the server; trusting its
 * hashes early would let a real content change get silently and permanently
 * skipped on every push after it.
 */

/**
 * The PUT body for one capture, and the content hash of every file whose
 * contents it ships or confirms. `confirmed` holds the hashes the server is
 * known to store already: those files ship no contents again.
 */
export async function buildGitStateSnapshot(
  target: SharedTarget,
  branch: string,
  porcelain: string,
  numstat: string,
  confirmed: ReadonlyMap<string, string> | undefined
): Promise<{ body: CloudGitStatePutBody; contentHashes: Map<string, string> }> {
  const entries = parseNumstat(numstat);
  const statuses = parsePorcelainStatuses(porcelain);

  // Untracked files appear in porcelain but NOT in numstat. Add them so the
  // participant's Changes tab mirrors the owner's, counted as numstat would
  // count them once added — all lines added, a binary as binary (ui4).
  const numstatPaths = new Set(entries.map((e) => e.path));
  for (const [path] of statuses) {
    if (!numstatPaths.has(path)) {
      const content = await readFile(resolve(target.repoPath, path));
      entries.push({
        path,
        additions: countAddedLines(content),
        deletions: 0,
        binary: isBinaryContent(content),
      });
    }
  }

  interface Candidate {
    meta: CloudGitFileMeta;
    content: CloudGitFileContent | null;
    bytes: number;
  }

  const candidates: Candidate[] = [];
  for (const entry of entries) {
    const status = statuses.get(entry.path) ?? 'modified';
    const meta: CloudGitFileMeta = {
      path: entry.path,
      status,
      additions: entry.additions,
      deletions: entry.deletions,
      content_omitted: true,
    };

    if (entry.binary) {
      // A binary pre/post-image read as utf-8 produces a garbage diff that
      // looks authoritative — omit, exactly like an over-cap file.
      candidates.push({ meta, content: null, bytes: 0 });
      continue;
    }

    const original =
      status === 'added' ? '' : await runGit(target.repoPath, ['show', `HEAD:${entry.path}`]);
    const modified =
      status === 'deleted' ? '' : await readFile(resolve(target.repoPath, entry.path), 'utf-8');

    if (
      Buffer.byteLength(original, 'utf8') > GIT_FILE_SIDE_BYTE_CAP ||
      Buffer.byteLength(modified, 'utf8') > GIT_FILE_SIDE_BYTE_CAP
    ) {
      candidates.push({ meta, content: null, bytes: 0 });
      continue;
    }

    const contentHash = computeContentHash(original, modified);
    if (confirmed?.get(entry.path) === contentHash) {
      // Byte-identical to the version the server is confirmed to already
      // have stored — the row stays put, nothing to transmit this push.
      meta.content_omitted = false;
      meta.content_hash = contentHash;
      candidates.push({ meta, content: null, bytes: 0 });
      continue;
    }

    const bytes = Buffer.byteLength(original, 'utf8') + Buffer.byteLength(modified, 'utf8');
    candidates.push({
      meta,
      content: { path: entry.path, original, modified },
      bytes,
    });
  }

  // Total budget: include contents ascending by size until it runs out; the
  // rest stay content_omitted. Ordering by size maximizes the file count.
  // Only files actually needing transmission compete for the budget — an
  // unchanged file costs nothing here, so it no longer crowds out a
  // genuinely new/changed one the way a full resend always did.
  const withContent = candidates
    .filter((c) => c.content !== null)
    .sort((a, b) => a.bytes - b.bytes);
  let budget = GIT_SNAPSHOT_CONTENT_BYTE_BUDGET;
  const contents: CloudGitFileContent[] = [];
  for (const candidate of withContent) {
    if (candidate.bytes > budget) continue;
    budget -= candidate.bytes;
    contents.push(candidate.content!);
    candidate.meta.content_omitted = false;
    candidate.meta.content_hash = computeContentHash(
      candidate.content!.original,
      candidate.content!.modified
    );
  }

  const files = candidates.map((c) => c.meta);
  const contentHashes = new Map(
    files
      .filter((f): f is typeof f & { content_hash: string } => !f.content_omitted)
      .map((f) => [f.path, f.content_hash])
  );

  return {
    body: {
      captured_at: new Date().toISOString(),
      branch_name: branch,
      files,
      contents,
    },
    contentHashes,
  };
}
