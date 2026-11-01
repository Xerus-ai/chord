/**
 * File-reference resolution for chat and the file finder.
 *
 * Detection is membership-based, not regex-guessing: a string only counts as a
 * file reference when the normalized path exists in the work item's real repo
 * file list, so ordinary inline code never becomes a false-positive link.
 */

export interface FileReference {
  path: string;
  line?: number;
}

/**
 * Resolve a text span (typically an inline-code span from agent output) to a
 * repo file, tolerating `./` prefixes, backslashes, and `:line[:col]` suffixes.
 * Returns null unless the normalized path is present in `repoFiles`.
 */
export function resolveFileReference(
  text: string,
  repoFiles: ReadonlySet<string>
): FileReference | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.includes('\n')) return null;

  let candidate = trimmed.replace(/\\/g, '/');
  if (candidate.startsWith('./')) candidate = candidate.slice(2);

  if (repoFiles.has(candidate)) return { path: candidate };

  const lineSuffix = candidate.match(/^(.+?):(\d+)(?::\d+)?$/);
  if (lineSuffix && repoFiles.has(lineSuffix[1])) {
    return { path: lineSuffix[1], line: Number(lineSuffix[2]) };
  }

  return null;
}

function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? path : path.slice(idx + 1);
}

/**
 * Score one file against a query. Higher is better; null means no match.
 * Contiguous basename hits rank above contiguous full-path hits, which rank
 * above scattered subsequence hits.
 */
function scoreFile(queryLower: string, path: string): number | null {
  const pathLower = path.toLowerCase();
  const nameLower = basename(pathLower);

  const nameIdx = nameLower.indexOf(queryLower);
  if (nameIdx !== -1) {
    // Earlier hits and shorter names win within the tier.
    return 3000 - nameIdx * 10 - nameLower.length;
  }

  const pathIdx = pathLower.indexOf(queryLower);
  if (pathIdx !== -1) {
    return 2000 - pathIdx - pathLower.length / 10;
  }

  // Subsequence: every query char must appear in order.
  let qi = 0;
  let firstHit = -1;
  for (let pi = 0; pi < pathLower.length && qi < queryLower.length; pi++) {
    if (pathLower[pi] === queryLower[qi]) {
      if (firstHit === -1) firstHit = pi;
      qi++;
    }
  }
  if (qi < queryLower.length) return null;
  return 1000 - firstHit - pathLower.length / 10;
}

/** Rank repo files against a query for the file finder. Empty query lists files as-is. */
export function fuzzyMatchFiles(query: string, files: readonly string[], limit: number): string[] {
  const queryLower = query.trim().toLowerCase();
  if (!queryLower) return files.slice(0, limit);

  const scored: Array<{ file: string; score: number }> = [];
  for (const file of files) {
    const score = scoreFile(queryLower, file);
    if (score !== null) scored.push({ file, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.file);
}
