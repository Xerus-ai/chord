import path from 'node:path';
import { eq } from 'drizzle-orm';
import z from 'zod';
import { gitAiOverrideSchema } from '@shared/git-ai';
import {
  AGENT_START_MODES,
  type AgentStartMode,
  type RepoJustMeSettings,
  type Resolved,
  type ResolvedRepoConfig,
  type ScriptKind,
} from '@shared/repo-config';
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
 * from. The shapes are `@shared/repo-config`'s; this file validates and
 * resolves them.
 */

/**
 * This machine's overrides for one repository (`RepoJustMeSettings`). Its
 * inferred type is held equal to that shape by resolve-repo-config.test.ts.
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
     * The repository that contains this one on this machine (`companion-checkout.ts`):
     * new lanes get the companion's worktree with their checkout nested in it.
     * Just me only, never the team file: the companion is private, its path
     * personal.
     */
    companionRepo: companionRepoSchema.optional(),
  })
  .strict();

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
