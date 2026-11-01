import type { Stats } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { RepoIconDetectionOutcome } from '@shared/repo-icon-detection';
import { MAX_REPO_ICON_IMAGE_BYTES, type RepoIcon } from '@shared/repo-icons';
import { declaredIconHrefCandidates, extractDeclaredIconHref } from './repo-icon-declared-href';
import { buildRepoIconFromImageBytes } from './repo-icon-image-bytes';

/**
 * Finds a project's own logo inside its local checkout, so the sidebar can
 * show it. Conventional icon paths are looked at first; after that, an icon
 * href declared in a page or root route file is followed into the repository.
 */

/** Conventional icon locations, most specific first, `.png` before `.webp` per stem. */
export const REPO_ICON_FILE_CANDIDATES: readonly string[] = [
  'favicon.png',
  'favicon.webp',
  'public/favicon.png',
  'public/favicon.webp',
  'app/favicon.png',
  'app/favicon.webp',
  'app/icon.png',
  'app/icon.webp',
  'src/favicon.png',
  'src/favicon.webp',
  'src/app/icon.png',
  'src/app/icon.webp',
  'assets/favicon.png',
  'assets/favicon.webp',
  'assets/icon.png',
  'assets/icon.webp',
  'static/favicon.png',
  'static/favicon.webp',
  'logo.png',
  'logo.webp',
  'public/logo.png',
  'public/logo.webp',
  'public/icon.png',
  'public/icon.webp',
  'src-tauri/icons/icon.png',
  'src-tauri/icons/icon.webp',
  'app-icon.png',
  'app-icon.webp',
  'icon.png',
  'icon.webp',
];

/** Files that may name the icon with a `<link rel="icon">` or a `{ rel: 'icon' }` entry, in search order. */
const ICON_DECLARING_FILES: readonly string[] = [
  'index.html',
  'public/index.html',
  'app/routes/__root.tsx',
  'src/routes/__root.tsx',
  'app/root.tsx',
  'src/root.tsx',
  'src/index.html',
];

/** A regular file within the cap that then could not be read: it ends the scan as `failed`. */
class UnreadableIconPathError extends Error {
  constructor(readonly readError: unknown) {
    super(`Cannot read a repo icon candidate: ${String(readError)}`);
  }
}

/** The path's stats, or `null` when it cannot be stat'ed (missing, unsearchable, a loop, an invalid name). */
async function statIconPath(filePath: string): Promise<Stats | null> {
  try {
    return await stat(filePath);
  } catch {
    // Any stat failure makes the path unusable, the same as a missing one (spec 2).
    return null;
  }
}

/**
 * Returns the bytes of a regular file no larger than the icon byte cap, or
 * `null` when the path cannot be stat'ed, is not a regular file, or is too
 * large. The size is checked before reading, so an oversized file is never
 * buffered. Reading a file that passed those checks and failing throws
 * `UnreadableIconPathError`.
 */
async function readCappedRegularFile(filePath: string): Promise<Buffer | null> {
  const info = await statIconPath(filePath);
  if (!info || !info.isFile() || info.size > MAX_REPO_ICON_IMAGE_BYTES) return null;
  try {
    return await readFile(filePath);
  } catch (error) {
    throw new UnreadableIconPathError(error);
  }
}

/** The icon held at `relativePath`, or `null` when that path is not a usable image. */
async function readIconAt(repoPath: string, relativePath: string): Promise<RepoIcon | null> {
  const bytes = await readCappedRegularFile(join(repoPath, relativePath));
  return bytes ? buildRepoIconFromImageBytes(bytes, 'file') : null;
}

/** The first usable icon an icon-declaring file points at, or `null`. */
async function readDeclaredIcon(repoPath: string, declaringFile: string): Promise<RepoIcon | null> {
  const source = await readCappedRegularFile(join(repoPath, declaringFile));
  if (!source) return null;

  const href = extractDeclaredIconHref(source.toString('utf8'));
  if (!href) return null;

  for (const candidate of declaredIconHrefCandidates(href, declaringFile)) {
    const icon = await readIconAt(repoPath, candidate);
    if (icon) return icon;
  }
  return null;
}

/** The first usable icon among the candidates, then the declaring files' hrefs, or `null`. */
async function scanForIcon(repoPath: string): Promise<RepoIcon | null> {
  for (const candidate of REPO_ICON_FILE_CANDIDATES) {
    const icon = await readIconAt(repoPath, candidate);
    if (icon) return icon;
  }
  for (const declaringFile of ICON_DECLARING_FILES) {
    const icon = await readDeclaredIcon(repoPath, declaringFile);
    if (icon) return icon;
  }
  return null;
}

/**
 * Looks for an icon image in the checkout at `repoPath`. `failed` means the
 * repository directory, or a regular file in it that passed its stat, could
 * not be read; a path that holds no usable image is skipped, and `none` means
 * every path was tried.
 */
export async function detectRepoIconFile(repoPath: string): Promise<RepoIconDetectionOutcome> {
  try {
    const info = await stat(repoPath);
    if (!info.isDirectory()) return { kind: 'failed', error: `${repoPath} is not a directory` };
  } catch (error) {
    return { kind: 'failed', error: `Cannot read ${repoPath}: ${String(error)}` };
  }

  try {
    const icon = await scanForIcon(repoPath);
    return icon ? { kind: 'found', icon } : { kind: 'none' };
  } catch (error) {
    if (error instanceof UnreadableIconPathError) return { kind: 'failed', error: error.message };
    throw error;
  }
}
