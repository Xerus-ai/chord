import type { RepoIcon } from './repo-icons';

/**
 * How a detection attempt ended. Three states rather than `RepoIcon | null`,
 * because the persist decision turns on the difference between the last two:
 *
 * - `found` — persist the icon.
 * - `none` — every probe ran and definitively answered nothing: no candidate
 *   file, and either no GitHub remote or an avatar endpoint that said 404.
 *   Persists `{ type: 'letter' }`, which settles it.
 * - `failed` — a probe could not complete: network error, timeout, 5xx,
 *   unreadable directory. Persists NOTHING, so the column stays NULL and the
 *   next launch tries again. Recording a dropped Wi-Fi connection as "this
 *   repository has no icon" would be permanent, and silent.
 */
export type RepoIconDetectionOutcome =
  | { kind: 'found'; icon: RepoIcon }
  | { kind: 'none' }
  | { kind: 'failed'; error: string };
