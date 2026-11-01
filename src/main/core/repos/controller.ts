import { randomUUID } from 'node:crypto';
import { eq, isNull, sql } from 'drizzle-orm';
import { createRPCController } from '@shared/ipc/rpc';
import {
  isRepoIconKey,
  parseRepoIcon,
  serializeRepoIcon,
  type RepoIcon,
  type RepoIconChoice,
} from '@shared/repo-icons';
import { err, ok } from '@shared/result';
import { db } from '@main/db/client';
import { repos, workItems } from '@main/db/schema-work-items';
import { initGitRepository, isGitRepo } from './init-repository';
import { detectAndPersistRepoIcon, startRepoIconDetection } from './repo-icon-persistence';
import { listRepoOrigins } from './repo-remotes';

function validateRepoIconChoice(choice: RepoIconChoice): RepoIcon {
  if (choice?.type === 'letter') return { type: 'letter' };
  if (choice?.type === 'lucide') {
    if (!isRepoIconKey(choice.key)) {
      throw new Error(`Unknown repo icon key: ${String(choice.key)}`);
    }
    return { type: 'lucide', key: choice.key };
  }
  throw new Error(
    `repos.setIcon accepts only a lucide key or the letter tile, not ${String((choice as { type?: unknown })?.type)}`
  );
}

async function requireRepo(id: string): Promise<{ id: string; path: string }> {
  const [row] = await db
    .select({ id: repos.id, path: repos.path })
    .from(repos)
    .where(eq(repos.id, id))
    .limit(1);
  if (!row) throw new Error(`No repository with id ${id}`);
  return row;
}

async function countWorkItemsForRepo(repoId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)` })
    .from(workItems)
    .where(eq(workItems.repoId, repoId));
  return row?.total ?? 0;
}

export const reposController = createRPCController({
  /**
   * Archived repos are omitted by default: every caller that is not the
   * management UI is a create-a-work-item picker, and hiding the repo from
   * those is the entire point of archiving it.
   *
   * The work item count comes back on the same row via a grouped join rather
   * than a query per repo — the management UI needs it for every row, and it is
   * what the delete rule keys on.
   *
   * `icon` comes back PARSED, so no caller has to know the column is JSON. A
   * value this build cannot read throws rather than degrading to the letter
   * tile — see `parseRepoIcon`.
   */
  getAll: async (args?: { includeArchived?: boolean }) => {
    const rows = await db
      .select({
        id: repos.id,
        path: repos.path,
        alias: repos.alias,
        addedAt: repos.addedAt,
        archivedAt: repos.archivedAt,
        icon: repos.icon,
        workItemCount: sql<number>`count(${workItems.id})`,
      })
      .from(repos)
      .leftJoin(workItems, eq(workItems.repoId, repos.id))
      .where(args?.includeArchived ? undefined : isNull(repos.archivedAt))
      .groupBy(repos.id)
      .orderBy(repos.alias);

    return ok({
      repos: rows.map((row) => ({
        ...row,
        icon: row.icon === null ? null : parseRepoIcon(row.icon),
      })),
    });
  },

  /**
   * Every repo's normalized origin, archived ones included: a teammate's shared
   * item joins the group of the local repo with the same origin (shared-items
   * step 3, H7), and an archived repo's work items still sit in its group.
   */
  listRemotes: async () => ok({ remotes: await listRepoOrigins() }),

  /** Attaches a folder that is already a git repository. */
  create: async (args: { path: string; alias: string }) => {
    if (!(await isGitRepo(args.path))) {
      return err({
        type: 'not_git_repo' as const,
        path: args.path,
        message: `${args.path} is not a git repository.`,
      });
    }

    const id = randomUUID();
    await db.insert(repos).values({ id, path: args.path, alias: args.alias });

    // Not awaited: the probe may reach the network, and adding a repository has
    // to stay instant. The renderer picks the icon up off `repoIconDetected`.
    startRepoIconDetection(id, args.path);

    const [row] = await db.select().from(repos).where(eq(repos.id, id)).limit(1);
    return ok({ repo: row });
  },

  /**
   * Creates a repository where there wasn't one, then attaches it.
   *
   * The empty initial commit is not a formality: a fresh `git init` leaves HEAD
   * on an unborn branch, and provisioning a work item's worktree needs a source
   * ref that actually resolves. Without a commit the first work item on the repo
   * would fail with `branch-not-found`.
   */
  init: async (args: { path: string; alias: string }) => {
    const created = await initGitRepository(args.path);
    if (!created.success) return err(created.error);

    const id = randomUUID();
    await db.insert(repos).values({ id, path: args.path, alias: args.alias });

    startRepoIconDetection(id, args.path);

    const [row] = await db.select().from(repos).where(eq(repos.id, id)).limit(1);
    return ok({ repo: row });
  },

  /**
   * Hides a repo from the pickers while keeping its row. The row is what
   * `work_items.repo_id` resolves against — including the repo-level trust
   * decision — so archiving costs its work items nothing.
   */
  setArchived: async (args: { id: string; archived: boolean }) => {
    await db
      .update(repos)
      .set({ archivedAt: args.archived ? Math.floor(Date.now() / 1000) : null })
      .where(eq(repos.id, args.id));
    return ok();
  },

  /**
   * Chooses the glyph the repo wears in the sidebar, or settles it on the
   * coloured letter tile with `{ type: 'letter' }`.
   *
   * Resetting writes `letter` rather than clearing the column: NULL means
   * "never probed", so clearing would put the repo back in the backfill queue
   * and hand it a detected icon again on the next launch — undoing the user's
   * choice.
   *
   * An `image` is refused. The renderer has no upload path, so an image can
   * only ever be produced by detection in main; accepting one over the RPC
   * would be an upload path by the back door, and would let the renderer put an
   * arbitrary `data:` URI into a column the sidebar feeds to an `<img>`.
   *
   * Every failure throws rather than returning `err`: the `err` results in this
   * file describe things a user can do (pointing the picker at a folder that is
   * not a repository), and each has UI wording behind it. A bad icon shape or
   * an id with no repo row means the caller is wrong, and swallowing either
   * would let the write silently do nothing — an UPDATE matching no row is a
   * success in SQLite.
   */
  setIcon: async (args: { id: string; icon: RepoIconChoice }) => {
    const icon: RepoIcon = validateRepoIconChoice(args.icon);
    await requireRepo(args.id);

    await db
      .update(repos)
      .set({ icon: serializeRepoIcon(icon) })
      .where(eq(repos.id, args.id));
    return ok();
  },

  /**
   * Re-runs auto-detection for one repo now, at the user's request, and
   * persists whatever it finds under the same rules the backfill uses.
   *
   * The outcome comes back so the menu can say "No icon found" for `none` and
   * "Could not reach GitHub" for `failed` — the difference matters to the user
   * for the same reason it matters to the column, and a shared "nothing
   * happened" would hide a network problem behind a shrug.
   */
  detectIcon: async (args: { id: string }) => {
    const repo = await requireRepo(args.id);
    const outcome = await detectAndPersistRepoIcon(repo.id, repo.path);
    return ok({ outcome });
  },

  /**
   * Hard deletion, allowed only for a repo nothing points at.
   *
   * `work_items.repo_id` is `onDelete: 'set null'`, so deleting a repo in use
   * would silently orphan its work items: they would keep their worktrees but
   * lose the row that resolves their repo-level trust, and start coming back
   * untrusted. Archiving is the action for a repo you are done with; this is
   * for undoing a mistaken add. The guard lives here rather than in the UI so
   * the RPC is safe whatever calls it.
   */
  remove: async (id: string) => {
    const workItemCount = await countWorkItemsForRepo(id);
    if (workItemCount > 0) {
      return err({
        type: 'repo_in_use' as const,
        workItemCount,
        message: `${workItemCount} work item${workItemCount === 1 ? '' : 's'} still reference this repository. Archive it instead.`,
      });
    }

    await db.delete(repos).where(eq(repos.id, id));
    return ok();
  },
});
