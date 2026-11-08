import type { GitAiOverride } from './git-ai';
import type { RunMode, RunScriptMap, RunScriptsValue } from './run-scripts';
import type { WorktreeSourceVisibility } from './worktree-sources';

/**
 * A repository's settings as the main process resolves them and the
 * repository page shows and edits them (devstation-4x42.261). Resolution is
 * per key: built-in < Team file (`.chord.json` at the lane's target ref) <
 * Just me (`repo_settings.overrides`). The shapes live here so the renderer
 * never imports main; validation stays in main
 * (`repoJustMeSettingsSchema`, whose inferred type a test holds equal to
 * `RepoJustMeSettings`).
 */

export type ConfigLayer = 'default' | 'team' | 'justMe';
export type Resolved<T> = { value: T; layer: ConfigLayer };

export const AGENT_START_MODES = ['waitForSetup', 'immediately'] as const;
export type AgentStartMode = (typeof AGENT_START_MODES)[number];

/** The scripts that are one command each; `run` is a set of named ones (`./run-scripts`). */
export type ScriptKind = 'setup' | 'test' | 'teardown';

/**
 * This machine's overrides for one repository. A just-me script is the
 * user's own: it replaces the team's script of that kind and runs without
 * an approval, since nobody else wrote it.
 */
export type RepoJustMeSettings = {
  baseBranch?: string;
  agentStart?: AgentStartMode;
  keepLocalBaseUpToDate?: boolean;
  /** Where this repository's checkouts go, instead of `<worktree root>/<repo>`. Absolute. */
  worktreeFolder?: string;
  /** Repo › General: worktree sources for this repository only, per source. */
  worktreeSources?: { claudeCode?: WorktreeSourceVisibility; other?: WorktreeSourceVisibility };
  /** "Hide for this repo": no "Review N worktrees" line for this repository. */
  hideWorktreeReview?: boolean;
  scripts?: {
    setup?: string;
    /** Replaces the team's run scripts entirely, not per id. */
    run?: RunScriptsValue;
    test?: string;
    teardown?: string;
  };
  /** Settings › Git › AI fields set for this repository only; the rest inherit. */
  gitAi?: GitAiOverride;
  /**
   * The repository that contains this one on this machine (`companion-checkout.ts`):
   * new lanes get the companion's worktree with their checkout nested in it.
   * Just me only, never the team file: the companion is private, its path personal.
   */
  companionRepo?: {
    /** The companion's main checkout, absolute. */
    path: string;
    /** Where the repository sits inside the companion, e.g. `app`. */
    appFolder: string;
  };
};

export interface ResolvedRepoConfig {
  ref: string;
  /** Blob OID of the team file the team values came from. */
  oid: string | null;
  /** Null means "the remote's default branch". */
  baseBranch: Resolved<string | null>;
  /** Null means the preferred remote (`origin`, else the first). */
  remote: Resolved<string | null>;
  filesToCopy: Resolved<string[]>;
  /** `run` maps script id to command; a team or just-me string is id `default`. */
  scripts: Record<ScriptKind, Resolved<string | null>> & { run: Resolved<RunScriptMap> };
  runMode: Resolved<RunMode>;
  shellSetup: Resolved<string | null>;
  tmux: Resolved<boolean>;
  agentStart: Resolved<AgentStartMode>;
  keepLocalBaseUpToDate: Resolved<boolean>;
}

/**
 * The repository page's two write paths. In both, `null` clears a value so
 * the layer below applies again. A run value replaces the whole set of run
 * scripts: named ones are not merged per id.
 */
type ScriptsPatch = Partial<Record<ScriptKind, string | null>> & { run?: RunScriptsValue | null };
type WorktreeSourcesPatch = {
  [K in keyof NonNullable<RepoJustMeSettings['worktreeSources']>]?: WorktreeSourceVisibility | null;
};

export type JustMePatch = {
  [K in Exclude<keyof RepoJustMeSettings, 'scripts' | 'worktreeSources'>]?:
    | RepoJustMeSettings[K]
    | null;
} & { scripts?: ScriptsPatch; worktreeSources?: WorktreeSourcesPatch };

export interface TeamConfigPatch {
  baseBranch?: string | null;
  filesToCopy?: string[] | null;
  shellSetup?: string | null;
  runMode?: RunMode | null;
  scripts?: ScriptsPatch;
}
