import path from 'node:path';
import { safePathSegment } from '@shared/path-name';

/**
 * The folder a repository's checkouts go in: the repository's own folder when
 * the user set one (Repo › General, just me), else `<worktree root>/<repo>` —
 * one pool per repository, so two repositories with a lane of the same name
 * never collide. Pure, so it is tested without settings or a database.
 */
export function resolveLanePoolPath(args: {
  /** Settings › General: where checkouts go. */
  worktreeRoot: string;
  repoLabel: string;
  repoId: string | null;
  /** Absolute; validated by the just-me schema. */
  justMeFolder: string | undefined;
}): string {
  if (args.justMeFolder) return args.justMeFolder;
  return path.join(args.worktreeRoot, safePathSegment(args.repoLabel, args.repoId ?? 'repo'));
}
