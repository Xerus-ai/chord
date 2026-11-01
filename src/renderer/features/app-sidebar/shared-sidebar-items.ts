import type { ArtifactsOnlyWorkItem, WorkItemOwner } from '@chord/protocol';
import type { NeedsYouPullRequests } from '@shared/sidebar-summaries';
import type { CloudWorkItem } from '@renderer/lib/cloud-api';
import { mergePullRequestReasons } from './needs-you-pull-request-reasons';
import { ORIGIN_UNKNOWN_HINT, type SidebarItem } from './sidebar-projection';

/** A local repo's normalized origin (`repos.listRemotes`). */
export interface LocalRepoRemote {
  repoId: string;
  alias: string;
  remoteUrl: string | null;
}

export type LocalRepoByRemote = ReadonlyMap<string, { repoId: string; alias: string }>;

/**
 * Local repos by origin. Two clones of one repo on this machine are two
 * groups; a teammate's item joins the first by alias, so it lands in the same
 * one on every render.
 */
export function buildLocalRepoByRemote(remotes: readonly LocalRepoRemote[]): LocalRepoByRemote {
  const byRemote = new Map<string, { repoId: string; alias: string }>();
  const byAlias = [...remotes].sort((a, b) => a.alias.localeCompare(b.alias));
  for (const { repoId, alias, remoteUrl } of byAlias) {
    if (remoteUrl !== null && !byRemote.has(remoteUrl)) byRemote.set(remoteUrl, { repoId, alias });
  }
  return byRemote;
}

/** Repo grouping needs a key for every row; an item with no repo row still
 *  has a path-derived alias, and one with neither is its own group. */
export function repoIdentity(repoId: string | null, repoAlias: string | null) {
  const label = repoAlias ?? 'No repository';
  return { repoId: repoId ?? repoAlias ?? 'no-repo', repoLabel: label };
}

/**
 * A teammate's item sits in the user's own group for the same repo (shared-
 * items step 3, decision 5). With no local match it gets a group of its own,
 * keyed by its origin so two different repos that share a name stay apart,
 * and named after the owner's repo.
 */
function sharedRepoIdentity(
  item: { repo_name: string | null; repo_remote_url: string | null },
  localRepoByRemote: LocalRepoByRemote
) {
  const local = item.repo_remote_url ? localRepoByRemote.get(item.repo_remote_url) : undefined;
  if (local) return { repoId: local.repoId, repoLabel: local.alias, repoHint: null };
  return {
    ...repoIdentity(item.repo_remote_url ?? item.repo_name, item.repo_name),
    repoHint: item.repo_remote_url ? originPath(item.repo_remote_url) : ORIGIN_UNKNOWN_HINT,
  };
}

/** A normalized origin (`host/owner/repo`) without its host: what names the repo to a person. */
function originPath(remoteUrl: string): string {
  return remoteUrl.slice(remoteUrl.indexOf('/') + 1);
}

function ownerTile(owner: WorkItemOwner): NonNullable<SidebarItem['owner']> {
  return { name: owner.creator_name ?? owner.creator_email, avatarUrl: owner.creator_avatar_url };
}

function epochSeconds(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

/** A teammate's item carries no local summary: no worktrees on this machine,
 *  no diff, no live sessions. Its only attention signal is its PR. */
export function toSharedSidebarItem(
  item: CloudWorkItem,
  localRepoByRemote: LocalRepoByRemote,
  pullRequests: NeedsYouPullRequests | undefined
): SidebarItem {
  return {
    id: item.id,
    name: item.name,
    ...sharedRepoIdentity(item, localRepoByRemote),
    branchName: item.branch_name,
    bucket: item.status === 'done' ? 'done' : 'idle',
    updatedAt: epochSeconds(item.updated_at),
    createdAt: epochSeconds(item.created_at),
    ownership: 'team',
    owner: ownerTile(item),
    sharedArtifacts: null,
    diffStats: null,
    pullRequestUrl: item.pr_url,
    // The cloud item carries a PR url and no synced PR row behind it, so
    // there is no state or check result to report — inventing 'in_review'
    // from the url alone would put a green glyph on an unknown PR.
    pullRequest: null,
    providerId: null,
    devServerUrl: null,
    worktreeCount: 1,
    liveSessionCount: 0,
    needsYou: mergePullRequestReasons([], item.pr_url, pullRequests),
    unread: false,
    provisionStatus: null,
    ownedByAnotherAccount: false,
    compareCue: null,
  };
}

/**
 * An item reached only through artifacts shared alone: its header and those
 * artifacts, nothing of the work item behind them (no branch, no PR).
 */
export function toArtifactsOnlySidebarItem(
  item: ArtifactsOnlyWorkItem,
  localRepoByRemote: LocalRepoByRemote
): SidebarItem {
  const updatedAt = epochSeconds(item.updated_at);
  return {
    id: item.id,
    name: item.name,
    ...sharedRepoIdentity(item, localRepoByRemote),
    branchName: null,
    bucket: item.status === 'done' ? 'done' : 'idle',
    updatedAt,
    // The header carries no creation time; "Created" sorts it by its last change.
    createdAt: updatedAt,
    ownership: 'team',
    owner: ownerTile(item),
    sharedArtifacts: item.shared_artifacts,
    diffStats: null,
    pullRequestUrl: null,
    pullRequest: null,
    providerId: null,
    devServerUrl: null,
    worktreeCount: 1,
    liveSessionCount: 0,
    needsYou: [],
    unread: false,
    provisionStatus: null,
    ownedByAnotherAccount: false,
    compareCue: null,
  };
}
