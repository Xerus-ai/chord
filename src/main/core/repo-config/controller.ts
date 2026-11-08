import { and, eq, isNull } from 'drizzle-orm';
import { ZodError } from 'zod';
import { createRPCController } from '@shared/ipc/rpc';
import type { JustMePatch, TeamConfigPatch } from '@shared/repo-config';
import { err, ok } from '@shared/result';
import { revokeAllApprovals, revokeRepoApproval } from '@main/core/workspaces/script-approval';
import { db } from '@main/db/client';
import { repos, workItems, workItemWorktrees } from '@main/db/schema-work-items';
import { RepoConfigError } from './read-team-config';
import { readRepoSettingsView, readRepoTrustView } from './repo-settings-view';
import { updateJustMeSettings, writeTeamConfigFile } from './repo-settings-writes';
import { resolveDefaultBaseRef } from './resolve-lane-base';
import { TeamFileOffBaseError } from './team-file-lineage';

/**
 * Settings › Repository › <repo>. Reads come back with the layer each value
 * came from; the `err` results are things the user can fix (an invalid value,
 * a `.chord.json` that does not parse) and carry the message to show.
 *
 * Trust can only be taken away here. Approving scripts happens in main's own
 * window, at the moment they would run — never from the renderer.
 */
export const repoSettingsController = createRPCController({
  get: async (repoId: string) => ok(await readRepoSettingsView(repoId)),

  getTrust: async (repoId: string) => ok(await readRepoTrustView(repoId)),

  /** This machine only. `null` clears a value so the team file or default applies. */
  updateJustMe: async (args: { repoId: string; patch: JustMePatch }) => {
    try {
      return ok({ justMe: updateJustMeSettings(args.repoId, args.patch) });
    } catch (error) {
      if (!(error instanceof ZodError)) throw error;
      const message = error.issues
        .map((issue) => `${issue.path.join('.') || 'value'}: ${issue.message}`)
        .join('; ');
      return err({ type: 'invalid_value' as const, message });
    }
  },

  /**
   * Edits the main checkout's `.chord.json` and leaves it uncommitted — only
   * when that edits the file the page shows: the one at the base new lanes
   * read it from.
   */
  writeTeamFile: async (args: { repoId: string; patch: TeamConfigPatch }) => {
    const [repo] = db
      .select({ path: repos.path })
      .from(repos)
      .where(eq(repos.id, args.repoId))
      .limit(1)
      .all();
    if (!repo) throw new Error(`No repository with id ${args.repoId}`);
    const base = await resolveDefaultBaseRef(repo.path);
    if (!base.success) {
      return err({ type: 'base_unresolved' as const, message: base.error.message });
    }
    try {
      return ok(await writeTeamConfigFile(repo.path, base.data, args.patch));
    } catch (error) {
      if (error instanceof TeamFileOffBaseError) {
        return err({ type: 'team_file_off_base' as const, message: error.message });
      }
      if (!(error instanceof RepoConfigError)) throw error;
      return err({ type: 'config_invalid' as const, message: error.message });
    }
  },

  /** Takes back Always trust and every lane's approval: the next script of any lane asks. */
  revokeTrust: async (repoId: string) => ok(revokeAllApprovals(repoId)),

  /** Turns Always trust off; lanes keep their own approvals. */
  turnOffAlwaysTrust: async (repoId: string) => {
    revokeRepoApproval(repoId);
    return ok();
  },

  /** The repository's live lanes, for Run & test › Run setup now. */
  listLanes: async (repoId: string) => {
    const lanes = db
      .select({
        id: workItemWorktrees.id,
        workItemId: workItemWorktrees.workItemId,
        workItemName: workItems.name,
        branchName: workItemWorktrees.branchName,
        path: workItemWorktrees.path,
        setupStatus: workItemWorktrees.setupStatus,
      })
      .from(workItemWorktrees)
      .innerJoin(workItems, eq(workItems.id, workItemWorktrees.workItemId))
      .where(and(eq(workItems.repoId, repoId), isNull(workItemWorktrees.archivedAt)))
      .orderBy(workItems.name)
      .all();
    return ok({ lanes });
  },
});
