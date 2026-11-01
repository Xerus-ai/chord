import type { ArtifactSource } from '../artifact-surface';

/** Which copy of a binary artifact the viewer and its actions work on (main's `FileTarget`). */
export type ArtifactFileTarget =
  | { source: 'local'; artifactId: string; versionId?: string }
  /** A repo file that is no artifact (design 2026-09-26 §3). */
  | { source: 'repo'; workItemId: string; filePath: string; worktreeId?: string }
  | { source: 'cloud'; workItemId: string; artifactId: string; name: string; versionId?: string };

export function artifactFileTarget(args: {
  source: ArtifactSource;
  workItemId: string;
  artifactId: string;
  name: string;
  versionId?: string;
}): ArtifactFileTarget {
  return args.source === 'local'
    ? { source: 'local', artifactId: args.artifactId, versionId: args.versionId }
    : {
        source: 'cloud',
        workItemId: args.workItemId,
        artifactId: args.artifactId,
        name: args.name,
        versionId: args.versionId,
      };
}
