import { realpathSync } from 'node:fs';
import { normalize, sep } from 'node:path';

/**
 * Windows and macOS default to case-insensitive filesystems, so `/Site` and
 * `/site` are one directory there; on Linux they are two, and a
 * case-insensitive comparison would let `../Site/x` out of `/site`.
 */
const CASE_INSENSITIVE_FS = process.platform === 'win32' || process.platform === 'darwin';

function comparable(path: string): string {
  const trimmed = normalize(path).replace(/[\\/]+$/, '');
  return CASE_INSENSITIVE_FS ? trimmed.toLowerCase() : trimmed;
}

/** Lexical containment: `candidate` is `root` or sits below it after normalisation. */
export function isPathInside(root: string, candidate: string): boolean {
  const normalizedRoot = comparable(root);
  const normalizedCandidate = comparable(candidate);
  return (
    normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(normalizedRoot + sep)
  );
}

/**
 * Containment after resolving symlinks on both sides, so a link inside `root`
 * that points elsewhere does not pass. Both paths must exist; a missing one
 * throws ENOENT for the caller to map to its own 404.
 */
export function isRealPathInside(root: string, candidate: string): boolean {
  return isPathInside(realpathSync.native(root), realpathSync.native(candidate));
}
