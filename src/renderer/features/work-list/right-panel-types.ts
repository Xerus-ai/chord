/**
 * What survives of the old right panel's type module: the one shape its file
 * rows still share with the diff viewer and the file finder.
 *
 * Everything else here described the retired panel's fixtures — `CheckEntry`
 * moved to `features/right-rail/checks-pr/pr-data.ts` with its queries, and
 * `CommitEntry`, `ReviewComment`, `LinkedItem`, `ContextArtifact`,
 * `DiscussionComment` and `ContextDetail` had no consumer left once the panel
 * went (AGENTS.md: delete the dead constants, keep the types still imported).
 */
export interface ChangedFile {
  name: string;
  added: number;
  removed: number;
  comments?: number;
  /** Has staged changes — one-click revert is hidden for these (it would be partial). */
  staged?: boolean;
}
