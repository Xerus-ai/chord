/**
 * Whether a path is git-ignored, from the list `git ls-files --others
 * --ignored --exclude-standard --directory` returns.
 *
 * `--directory` is what makes this affordable: git collapses a wholly ignored
 * directory into one entry (`node_modules/`) instead of naming its 40,000
 * files, so the list a real repository produces is dozens of entries, not tens
 * of thousands. The trailing slash is the marker — an entry with one covers
 * everything beneath it, an entry without one is a single file.
 */
export function buildIgnoredMatcher(entries: readonly string[]): (path: string) => boolean {
  const files = new Set<string>();
  const directories: string[] = [];

  for (const entry of entries) {
    if (entry.endsWith('/')) directories.push(entry.slice(0, -1));
    else files.add(entry);
  }

  if (files.size === 0 && directories.length === 0) return () => false;

  return (path: string) => {
    if (files.has(path)) return true;
    // Boundary-aware: `out/` must not dim `outbox`.
    return directories.some((directory) => path === directory || path.startsWith(`${directory}/`));
  };
}
