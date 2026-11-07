import path from 'node:path';
import { eq } from 'drizzle-orm';
import z from 'zod';
import { gitAiOverrideSchema } from '@shared/git-ai';
import {
  buildRunScriptsSchema,
  expandRunScripts,
  type RunMode,
  type RunScriptMap,
  type RunScriptsValue,
} from '@shared/run-scripts';
import { WORKTREE_SOURCE_VISIBILITIES } from '@shared/worktree-sources';
import { DEFAULT_FILES_TO_COPY, type ProjectSettings } from '@main/core/projects/settings/schema';
import { companionRepoSchema } from '@main/core/work-items/companion-checkout';
import { db } from '@main/db/client';
import { repoSettings } from '@main/db/schema-repo-settings';
import { readTeamConfigAtRef } from './read-team-config';

/**
 * One answer to "what is this repository's setting X", with where it came
 * from. Resolution is per key: built-in < Team file (`.chord.json` at the
 * lane's target ref) < Just me (`repo_settings.overrides`).
 */

export type ConfigLayer = 'default' | 'team' | 'justMe';
export type Resolved<T> = { value: T; layer: ConfigLayer };

export const AGENT_START_MODES = ['waitForSetup', 'immediately'] as const;
export type AgentStartMode = (typeof AGENT_START_MODES)[number];

/** The scripts that are one command each; `run` is a set of named ones (`@shared/run-scripts`). */
export const SCRIPT_KINDS = ['setup', 'test', 'teardown'] as const;
export type ScriptKind = (typeof SCRIPT_KINDS)[number];

/**
 * This machine's overrides for one repository. A just-me script is the
 * user's own — it replaces the team's script of that kind and runs without
 * an approval, since nobody else wrote it.
 */
export const repoJustMeSettingsSchema = z
  .object({
    baseBranch: z.string().trim().min(1).optional(),
    agentStart: z.enum(AGENT_START_MODES).optional(),
    keepLocalBaseUpToDate: z.boolean().optional(),
    /** Where this repository's checkouts go, instead of `<worktree root>/<repo>`. */
    worktreeFolder: z
      .string()
      .trim()
      .refine((value) => path.isAbsolute(value), 'must be an absolute path')
      .optional(),
    /** Repo › General: worktree sources for this repository only, per source. */
    worktreeSources: z
      .object({
        claudeCode: z.enum(WORKTREE_SOURCE_VISIBILITIES).optional(),
        other: z.enum(WORKTREE_SOURCE_VISIBILITIES).optional(),
      })
      .strict()
      .optional(),
    /** "Hide for this repo": no "Review N worktrees" line for this repository. */
    hideWorktreeReview: z.boolean().optional(),
    scripts: z
      .object({
        setup: z.string().trim().min(1).optional(),
        /** Replaces the team's run scripts entirely, not per id. */
        run: buildRunScriptsSchema(z.string().trim().min(1)).optional(),
        test: z.string().trim().min(1).optional(),
        teardown: z.string().trim().min(1).optional(),
      })
      .strict()
      .optional(),
    /** Settings › Git › AI fields set for this repository only; the rest inherit. */
    gitAi: gitAiOverrideSchema.optional(),
    /**
     * A repository this one sits in on this machine (`companion-checkout.ts`):
     * new lanes get the companion's worktree with their checkout nested in it.
     * Just me only, never the team file: the companion is private, its path
     * personal.
     */
    companionRepo: companionRepoSchema.optional(),
  })
  .strict();

export type RepoJustMeSettings = z.infer<typeof repoJustMeSettingsSchema>;

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

/** Throws on stored overrides it cannot read — a corrupt row is a bug, not "no overrides". */
export function readJustMeSettings(repoId: string | null): RepoJustMeSettings {
  if (!repoId) return {};
  const [row] = db
    .select({ overrides: repoSettings.overrides })
    .from(repoSettings)
    .where(eq(repoSettings.repoId, repoId))
    .limit(1)
    .all();
  if (!row) return {};
  return repoJustMeSettingsSchema.parse(JSON.parse(row.overrides));
}

function pick<T>(teamValue: T | undefined, fallback: T): Resolved<T> {
  return teamValue === undefined
    ? { value: fallback, layer: 'default' }
    : { value: teamValue, layer: 'team' };
}

function override<T>(resolved: Resolved<T>, justMeValue: T | undefined): Resolved<T> {
  return justMeValue === undefined ? resolved : { value: justMeValue, layer: 'justMe' };
}

/**
 * Resolves every repo-scoped setting for work at `ref`. Throws
 * `RepoConfigError` when the team file at `ref` is invalid.
 */
export async function resolveRepoConfig(args: {
  repoId: string | null;
  repoPath: string;
  ref: string;
}): Promise<ResolvedRepoConfig> {
  const team = await readTeamConfigAtRef(args.repoPath, args.ref);
  const justMe = readJustMeSettings(args.repoId);

  return {
    ref: team.ref,
    oid: team.oid,
    baseBranch: override(pick<string | null>(team.config.baseBranch, null), justMe.baseBranch),
    remote: pick<string | null>(team.config.remote, null),
    // The schema fills `filesToCopy` in, so whether the team set it is read
    // from the file's own keys.
    filesToCopy: pick(
      team.setKeys.has('filesToCopy') ? team.config.filesToCopy : undefined,
      DEFAULT_FILES_TO_COPY
    ),
    scripts: resolveScripts(team.config.scripts, justMe.scripts),
    shellSetup: pick<string | null>(team.config.shellSetup, null),
    tmux: pick(team.config.tmux, false),
    runMode: pick<RunMode>(team.config.runMode, 'perWorktree'),
    agentStart: override(pick<AgentStartMode>(undefined, 'waitForSetup'), justMe.agentStart),
    keepLocalBaseUpToDate: override(pick(undefined, false), justMe.keepLocalBaseUpToDate),
  };
}

function resolveScripts(
  team: ProjectSettings['scripts'],
  justMe: RepoJustMeSettings['scripts']
): ResolvedRepoConfig['scripts'] {
  const resolveOne = (kind: ScriptKind) =>
    override(pick<string | null>(team?.[kind], null), justMe?.[kind]);
  const expand = (value: RunScriptsValue | undefined) =>
    value === undefined ? undefined : expandRunScripts(value);
  return {
    setup: resolveOne('setup'),
    run: override(pick<RunScriptMap>(expand(team?.run), {}), expand(justMe?.run)),
    test: resolveOne('test'),
    teardown: resolveOne('teardown'),
  };
}
