import type { StreamItem } from '@shared/stream-items';
import {
  resolveAgentReportedPath,
  type AgentPathEnvironment,
} from '@main/utils/agent-reported-path';

export type ChangedFile = Extract<StreamItem, { kind: 'file_changes' }>['files'][number];

/**
 * The files an agent edited during a turn, as the file-changed strip renders
 * them. Both sources are agent-reported — the tool's own `locations`, or the
 * `file_path`/`path` argument it was called with — so both are translated
 * against the session workspace: the strip has to name a file the user can
 * open, not the MSYS rendering (`/tmp/repo/notes.md`) the agent printed.
 *
 * `environment` is threaded through for tests that pin the platform; callers
 * in the app let the translator read the real one.
 */
export function collectChangedFiles(
  items: StreamItem[],
  cwd: string | null,
  environment?: AgentPathEnvironment
): ChangedFile[] {
  const seen = new Set<string>();
  const files: ChangedFile[] = [];

  for (const item of items) {
    if (item.kind !== 'tool_group') continue;
    for (const tool of item.tools) {
      if (tool.kind !== 'edit') continue;

      const reportedPaths: string[] = [];
      if (tool.locations && tool.locations.length > 0) {
        for (const location of tool.locations) reportedPaths.push(location.filePath);
      } else if (tool.rawInput) {
        const reported = (tool.rawInput.file_path ?? tool.rawInput.path) as string | undefined;
        if (reported) reportedPaths.push(reported);
      }

      let added = 0;
      let removed = 0;
      for (const block of tool.contentBlocks ?? []) {
        for (const line of (block.diff ?? '').split('\n')) {
          if (line.startsWith('+') && !line.startsWith('+++')) added++;
          else if (line.startsWith('-') && !line.startsWith('---')) removed++;
        }
      }

      for (const reported of reportedPaths) {
        const filePath = environment
          ? resolveAgentReportedPath(reported, cwd, environment)
          : resolveAgentReportedPath(reported, cwd);
        if (seen.has(filePath)) continue;
        seen.add(filePath);
        // Agent machinery, not the user's work: plan-mode drafts under
        // ~/.claude/plans (and anything else in a .claude dir) don't belong
        // in the changed-files strip.
        if (filePath.split(/[\\/]/).includes('.claude')) continue;
        const segments = filePath.replace(/\\/g, '/').split('/');
        files.push({
          name: segments[segments.length - 1] ?? filePath,
          filePath,
          added,
          removed,
        });
      }
    }
  }

  return files;
}
