import z from 'zod';
import type { UpdateProjectSettingsError } from '@shared/projects';
import type { Result } from '@shared/result';
import { buildRunScriptsSchema, RUN_MODES } from '@shared/run-scripts';

export const DEFAULT_FILES_TO_COPY = ['.env*', '.envrc'];

/**
 * A repository's `.chord.json` — the "Team file" layer of the repo config
 * resolver (`core/repo-config/`). Strict: a key this build does not know is a
 * typo or a setting that moved, and ignoring it would silently change what
 * runs, so it is a parse error instead.
 */
export const projectSettingsSchema = z
  .object({
    // The branch new lanes fork from and open their PR against. Unset means
    // the remote's default branch (`origin/HEAD`).
    baseBranch: z.string().trim().min(1).optional(),
    remote: z.string().trim().min(1).optional(),
    // Gitignored files copied from the main checkout into each new checkout.
    // Tracked files are never copied (they are already in the checkout).
    filesToCopy: z.array(z.string()).optional().default(DEFAULT_FILES_TO_COPY),
    shellSetup: z.string().optional(),
    tmux: z.boolean().optional(),
    // Whether the app can run once per lane or only one lane at a time: the
    // codebase's property, so team-only.
    runMode: z.enum(RUN_MODES).optional(),
    scripts: z
      .object({
        setup: z.string().optional(),
        // One command (the `default` script), or named commands.
        run: buildRunScriptsSchema(z.string()).optional(),
        test: z.string().optional(),
        teardown: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

/**
 * Keys earlier builds read from `.chord.json`, and what to do instead. A file
 * still using one gets this message rather than zod's "unrecognized key".
 */
export const RETIRED_TEAM_CONFIG_KEYS: Readonly<Record<string, string>> = {
  preservePatterns: 'renamed to `filesToCopy`',
  defaultBranch: 'renamed to `baseBranch`',
  worktreeDirectory:
    'no longer read from the repository: where checkouts go is a personal setting (Settings › General)',
  workspaceProvider:
    'removed: no build of Chord ran its provision or terminate commands, and lanes run only on this machine',
};

export interface ProjectSettingsProvider {
  getDefaultBranch(): Promise<string>;
  getRemote(): Promise<string>;
  getWorktreeDirectory(): Promise<string>;
  get(): Promise<ProjectSettings>;
  update(settings: ProjectSettings): Promise<Result<void, UpdateProjectSettingsError>>;
  ensure(): Promise<void>;
}
