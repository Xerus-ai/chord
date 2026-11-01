import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';

/**
 * The URL a repository fetches from: the team file's `remote` when it names
 * one that exists, else `origin`, else the first remote. Null for a
 * repository with none. "Always trust" is pinned to it.
 */
export async function readFetchRemoteUrl(
  repoPath: string,
  configured: string | null
): Promise<string | null> {
  const { stdout } = await new LocalExecutionContext({ root: repoPath }).exec(GIT_EXECUTABLE, [
    'remote',
    '-v',
  ]);
  const fetchUrls = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const match = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(line.trim());
    if (match?.[1] && match[2]) fetchUrls.set(match[1], match[2]);
  }
  const name =
    (configured && fetchUrls.has(configured) && configured) ||
    (fetchUrls.has('origin') ? 'origin' : fetchUrls.keys().next().value);
  return name ? (fetchUrls.get(name) ?? null) : null;
}
