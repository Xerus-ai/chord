import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { appSettingsService } from '@main/core/settings/settings-service';
import { resolveLanePoolPath } from '@main/core/work-items/lane-pool-path';
import {
  buildExecutableBundle,
  ClaudeConfigError,
  collectChordScripts,
  isBundleCoveredBy,
  readClaudeExecutableConfigAtRef,
  type BundleContent,
} from '@main/core/workspaces/executable-bundle';
import { readRepoApprovals, type RepoApprovals } from '@main/core/workspaces/script-approval';
import { db } from '@main/db/client';
import { repos } from '@main/db/schema-work-items';
import { readFetchRemoteUrl } from './fetch-remote-url';
import {
  readConfigBlob,
  readTeamConfigOid,
  RepoConfigError,
  TEAM_CONFIG_FILE,
} from './read-team-config';
import { resolveDefaultBaseRef } from './resolve-lane-base';
import {
  readJustMeSettings,
  resolveRepoConfig,
  type RepoJustMeSettings,
  type ResolvedRepoConfig,
} from './resolve-repo-config';
import { describeTeamFileOffBase } from './team-file-lineage';

/**
 * What the repository page shows, read where a new lane reads it: the team
 * file at the repository's default base (`origin/main`, or the branch a
 * remote-less repository is on), never the main checkout's working copy —
 * which is reported separately, because that is where a team edit is written.
 */

interface RepoRow {
  id: string;
  path: string;
  alias: string;
}

function requireRepo(repoId: string): RepoRow {
  const [repo] = db
    .select({ id: repos.id, path: repos.path, alias: repos.alias })
    .from(repos)
    .where(eq(repos.id, repoId))
    .limit(1)
    .all();
  if (!repo) throw new Error(`No repository with id ${repoId}`);
  return repo;
}

async function resolveBaseRef(repoPath: string): Promise<{ ref: string } | { error: string }> {
  const resolved = await resolveDefaultBaseRef(repoPath);
  return resolved.success ? { ref: resolved.data } : { error: resolved.error.message };
}

export type TeamFileState =
  /** No `.chord.json` in the main checkout, nor at the base. */
  | 'absent'
  /** The main checkout's file is the one at the base. */
  | 'same'
  /** It is not — an uncommitted edit, or a branch with its own — so lanes don't use it yet. */
  | 'differs';

export interface RepoSettingsView {
  repo: RepoRow;
  /** Null when the repository has no base to read at (see `configError`). */
  baseRef: string | null;
  config: ResolvedRepoConfig | null;
  configError: string | null;
  justMe: RepoJustMeSettings;
  /** The folder new lanes' checkouts go in, as `provisionWorkItemWorktree` derives it. */
  poolPath: string;
  teamFile: {
    path: string;
    state: TeamFileState;
    /** Why a team edit would be refused now (`writeTeamFile`), or null when it can be saved. */
    writeBlocked: string | null;
  };
}

async function readPoolPath(repo: RepoRow, justMe: RepoJustMeSettings): Promise<string> {
  const { defaultWorktreeDirectory } = await appSettingsService.get('localProject');
  return resolveLanePoolPath({
    worktreeRoot: defaultWorktreeDirectory,
    repoLabel: repo.alias,
    repoId: repo.id,
    justMeFolder: justMe.worktreeFolder,
  });
}

async function readTeamFileState(repoPath: string, baseRef: string | null): Promise<TeamFileState> {
  const file = path.join(repoPath, TEAM_CONFIG_FILE);
  const working = existsSync(file) ? await readFile(file, 'utf8') : null;
  const oid = baseRef === null ? null : await readTeamConfigOid(repoPath, baseRef);
  if (working === null && oid === null) return 'absent';
  if (working === null || oid === null) return 'differs';
  return working === (await readConfigBlob(repoPath, oid)) ? 'same' : 'differs';
}

async function readTeamWriteBlocked(repoPath: string, baseRef: string): Promise<string | null> {
  try {
    return await describeTeamFileOffBase(repoPath, baseRef);
  } catch (error) {
    // A checkout with no commit yet has no HEAD to read: the save would be
    // refused with this message too. Anything else is a bug.
    if (!(error instanceof RepoConfigError)) throw error;
    return error.message;
  }
}

export async function readRepoSettingsView(repoId: string): Promise<RepoSettingsView> {
  const repo = requireRepo(repoId);
  const justMe = readJustMeSettings(repoId);
  const teamFile = { path: path.join(repo.path, TEAM_CONFIG_FILE) };
  const poolPath = await readPoolPath(repo, justMe);

  const base = await resolveBaseRef(repo.path);
  if ('error' in base) {
    return {
      repo,
      baseRef: null,
      config: null,
      configError: base.error,
      justMe,
      poolPath,
      teamFile: {
        ...teamFile,
        state: await readTeamFileState(repo.path, null),
        writeBlocked: base.error,
      },
    };
  }
  let config: ResolvedRepoConfig | null = null;
  let configError: string | null = null;
  try {
    config = await resolveRepoConfig({ repoId, repoPath: repo.path, ref: base.ref });
  } catch (error) {
    // An invalid team file is shown in place of the settings; anything else is a bug.
    if (!(error instanceof RepoConfigError)) throw error;
    configError = error.message;
  }
  return {
    repo,
    baseRef: base.ref,
    config,
    configError,
    justMe,
    poolPath,
    teamFile: {
      ...teamFile,
      state: await readTeamFileState(repo.path, base.ref),
      writeBlocked: await readTeamWriteBlocked(repo.path, base.ref),
    },
  };
}

export interface RepoTrustView {
  baseRef: string | null;
  /** The URL the repository fetches from now. */
  remoteUrl: string | null;
  /** What a new lane from the base would ask about; null when nothing would run. */
  current: BundleContent | null;
  currentError: string | null;
  alwaysTrusted: RepoApprovals['alwaysTrusted'];
  /** Always trust covers what would run now (`isBundleCoveredBy`). */
  alwaysTrustedMatchesCurrent: boolean;
  /** Always trust was given for the remote fetched from now (else it is void). */
  alwaysTrustedRemoteMatches: boolean;
  approvedLaneCount: number;
}

async function readCurrentBundle(
  repoId: string,
  repoPath: string,
  baseRef: string
): Promise<{ current: ReturnType<typeof buildExecutableBundle>; remote: string | null }> {
  const config = await resolveRepoConfig({ repoId, repoPath, ref: baseRef });
  const current = buildExecutableBundle(
    collectChordScripts(config),
    await readClaudeExecutableConfigAtRef(repoPath, baseRef)
  );
  return { current, remote: config.remote.value };
}

export async function readRepoTrustView(
  repoId: string,
  options: { baseRef?: string } = {}
): Promise<RepoTrustView> {
  const repo = requireRepo(repoId);
  const approvals = readRepoApprovals(repoId);

  const base = options.baseRef ? { ref: options.baseRef } : await resolveBaseRef(repo.path);
  let current: ReturnType<typeof buildExecutableBundle> = null;
  let currentError: string | null = null;
  let configuredRemote: string | null = null;
  if ('error' in base) {
    currentError = base.error;
  } else {
    try {
      ({ current, remote: configuredRemote } = await readCurrentBundle(
        repoId,
        repo.path,
        base.ref
      ));
    } catch (error) {
      // An invalid `.chord.json` or Claude config file at the base: each
      // message names the file. Anything else is a bug.
      if (!(error instanceof RepoConfigError || error instanceof ClaudeConfigError)) throw error;
      currentError = error.message;
    }
  }

  const remoteUrl = await readFetchRemoteUrl(repo.path, configuredRemote);
  const trusted = approvals.alwaysTrusted;
  return {
    baseRef: 'error' in base ? null : base.ref,
    remoteUrl,
    current: current?.content ?? null,
    currentError,
    alwaysTrusted: trusted,
    alwaysTrustedMatchesCurrent:
      trusted !== null && current !== null && isBundleCoveredBy(trusted.content, current.content),
    alwaysTrustedRemoteMatches: trusted !== null && trusted.remoteUrl === remoteUrl,
    approvedLaneCount: approvals.approvedLaneCount,
  };
}
