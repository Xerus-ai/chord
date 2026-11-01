import { isAbsolute, relative } from 'node:path';

/**
 * Whether a file inside an agent session is a work-item deliverable at all.
 *
 * Only files inside the session workspace qualify. The agent also writes
 * machinery outside it — most notably its own plan-mode draft
 * (`~/.claude/plans/<random-name>.md`) — and anything under a `.claude`
 * directory or Chord's own `.chord/plans` record is machinery even when it
 * sits inside the workspace. The publish tool and the document-write
 * recorder apply the same rule, so a file the agent cannot publish never
 * turns up as an "Add to artifacts" chip either.
 */
export function isWorkspaceDeliverablePath(filePath: string, cwd: string): boolean {
  const segments = filePath.split(/[\\/]/);
  if (segments.includes('.claude')) return false;
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  if (normalized.includes('/.chord/plans/')) return false;
  const rel = relative(cwd, filePath);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}
