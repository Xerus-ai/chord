import type { ArtifactsOnlyWorkItem } from '@chord/protocol';
import { describe, expect, it } from 'vitest';
import type { CloudWorkItem } from '@renderer/lib/cloud-api';
import {
  buildLocalRepoByRemote,
  toArtifactsOnlySidebarItem,
  toSharedSidebarItem,
} from './shared-sidebar-items';
import { DEFAULT_SIDEBAR_OPTIONS } from './sidebar-options-model';
import { projectSidebar, type SidebarItem } from './sidebar-projection';

/**
 * Shared-items step 3 (H7, decisions 4 and 5): a teammate's work item sits in
 * the user's own group for the same repo, matched by normalized origin, else
 * in a group named after the owner's repo; its tile is the owner's avatar; an
 * item reached only through artifacts shared alone is a row that says how
 * many.
 */

const OWNER = {
  creator_id: 'u-kai',
  creator_name: 'Kai Ahn',
  creator_email: 'kai@acme.dev',
  creator_avatar_url: 'https://avatars.test/kai.png',
};

function cloudItem(overrides: Partial<CloudWorkItem> = {}): CloudWorkItem {
  return {
    ...OWNER,
    access_scope: 'work_item',
    id: 'shared-1',
    org_id: 'org',
    name: 'Fix checkout',
    status: 'active',
    workflow_phase: 'build',
    ticket_id: null,
    ticket_provider: null,
    ticket_url: null,
    pr_number: null,
    pr_url: null,
    repo_name: 'chord-kai',
    repo_remote_url: 'github.com/acme/chord',
    branch_name: 'kai/checkout',
    agent_provider: null,
    general_access: 'invited',
    general_role: 'view',
    approval_policy: 'owner',
    delivery_policy: 'manual',
    version_number: 3,
    created_at: '2026-09-20T10:00:00.000Z',
    updated_at: '2026-09-27T10:00:00.000Z',
    ...overrides,
  };
}

function artifactsOnly(overrides: Partial<ArtifactsOnlyWorkItem> = {}): ArtifactsOnlyWorkItem {
  return {
    ...OWNER,
    access_scope: 'artifacts',
    id: 'shared-2',
    org_id: 'org',
    name: 'Landing page',
    status: 'active',
    repo_name: 'chord-kai',
    repo_remote_url: 'github.com/acme/chord',
    updated_at: '2026-09-27T09:00:00.000Z',
    version_number: 1,
    shared_artifacts: [{ id: 'a-1', name: 'copy.md' }],
    ...overrides,
  };
}

const LOCAL_REPOS = buildLocalRepoByRemote([
  { repoId: 'r-chord', alias: 'chord', remoteUrl: 'github.com/acme/chord' },
  { repoId: 'r-web', alias: 'web', remoteUrl: 'github.com/acme/web' },
  { repoId: 'r-scratch', alias: 'scratch', remoteUrl: null },
]);

function mine(id: string, repoId: string, repoLabel: string): SidebarItem {
  return {
    ...toSharedSidebarItem(cloudItem({ id }), LOCAL_REPOS, undefined),
    ownership: 'mine',
    owner: null,
    repoId,
    repoLabel,
    repoHint: null,
  };
}

describe('toSharedSidebarItem', () => {
  it("joins the user's own repo group when the origins match", () => {
    expect(toSharedSidebarItem(cloudItem(), LOCAL_REPOS, undefined)).toMatchObject({
      repoId: 'r-chord',
      repoLabel: 'chord',
      ownership: 'team',
    });
  });

  it("falls into a group named after the owner's repo when nothing local matches", () => {
    const item = toSharedSidebarItem(
      cloudItem({ repo_remote_url: 'github.com/acme/billing', repo_name: 'billing' }),
      LOCAL_REPOS,
      undefined
    );
    expect(item.repoLabel).toBe('billing');
    expect(item.repoId).not.toBe('r-chord');
  });

  it("uses the owner's repo name for an item whose owner has not sent a remote yet", () => {
    const item = toSharedSidebarItem(cloudItem({ repo_remote_url: null }), LOCAL_REPOS, undefined);
    expect(item.repoLabel).toBe('chord-kai');
    expect(item.repoId).not.toBe('r-chord');
  });

  it('keeps two unmatched repos that share a name apart', () => {
    const a = toSharedSidebarItem(
      cloudItem({ repo_remote_url: 'github.com/one/api', repo_name: 'api' }),
      LOCAL_REPOS,
      undefined
    );
    const b = toSharedSidebarItem(
      cloudItem({ repo_remote_url: 'github.com/two/api', repo_name: 'api' }),
      LOCAL_REPOS,
      undefined
    );
    expect(a.repoId).not.toBe(b.repoId);
  });

  it("wears the owner's avatar", () => {
    expect(toSharedSidebarItem(cloudItem(), LOCAL_REPOS, undefined).owner).toEqual({
      name: 'Kai Ahn',
      avatarUrl: 'https://avatars.test/kai.png',
    });
    expect(
      toSharedSidebarItem(cloudItem({ creator_name: null }), LOCAL_REPOS, undefined).owner
    ).toEqual({ name: 'kai@acme.dev', avatarUrl: 'https://avatars.test/kai.png' });
  });

  it('is a work item row, not an artifacts row', () => {
    expect(toSharedSidebarItem(cloudItem(), LOCAL_REPOS, undefined).sharedArtifacts).toBeNull();
  });
});

describe('toArtifactsOnlySidebarItem', () => {
  it("is a team row in the matching repo group, with the owner's avatar and its artifacts", () => {
    const item = toArtifactsOnlySidebarItem(
      artifactsOnly({
        shared_artifacts: [
          { id: 'a-1', name: 'copy.md' },
          { id: 'a-2', name: 'hero.html' },
        ],
      }),
      LOCAL_REPOS
    );
    expect(item).toMatchObject({
      id: 'shared-2',
      name: 'Landing page',
      repoId: 'r-chord',
      repoLabel: 'chord',
      ownership: 'team',
      owner: { name: 'Kai Ahn', avatarUrl: 'https://avatars.test/kai.png' },
      sharedArtifacts: [
        { id: 'a-1', name: 'copy.md' },
        { id: 'a-2', name: 'hero.html' },
      ],
      branchName: null,
      pullRequestUrl: null,
      bucket: 'idle',
    });
  });

  it('reads a done item as done', () => {
    expect(toArtifactsOnlySidebarItem(artifactsOnly({ status: 'done' }), LOCAL_REPOS).bucket).toBe(
      'done'
    );
  });
});

describe('buildLocalRepoByRemote', () => {
  it('picks one group for two local clones of the same repo: the first by alias', () => {
    const byRemote = buildLocalRepoByRemote([
      { repoId: 'r-z', alias: 'zeta', remoteUrl: 'github.com/acme/chord' },
      { repoId: 'r-a', alias: 'alpha', remoteUrl: 'github.com/acme/chord' },
    ]);
    expect(byRemote.get('github.com/acme/chord')).toEqual({ repoId: 'r-a', alias: 'alpha' });
  });
});

describe('grouping shared rows with the user’s own', () => {
  it('puts a matching shared item and an artifact-only item in the local repo group', () => {
    const projection = projectSidebar({
      items: [
        mine('own-1', 'r-chord', 'chord'),
        toSharedSidebarItem(cloudItem(), LOCAL_REPOS, undefined),
        toArtifactsOnlySidebarItem(artifactsOnly(), LOCAL_REPOS),
        toSharedSidebarItem(
          cloudItem({
            id: 'shared-3',
            repo_remote_url: 'github.com/acme/billing',
            repo_name: 'billing',
          }),
          LOCAL_REPOS,
          undefined
        ),
      ],
      pinnedIds: [],
      options: { ...DEFAULT_SIDEBAR_OPTIONS, repoOrder: 'name' },
      view: 'repo',
      nowSeconds: 1_800_000_000,
    });

    expect(
      projection.groups.map((group) => ({
        label: group.label,
        ids: group.items.map((item) => item.id).sort(),
      }))
    ).toEqual([
      { label: 'billing', ids: ['shared-3'] },
      { label: 'chord', ids: ['own-1', 'shared-1', 'shared-2'] },
    ]);
  });
});

/**
 * Shared-items step 4, decision 2: a group named like another says what sets
 * it apart. Only a teammate's group that matched no local repo carries a hint
 * (its origin as owner/repo, or that the origin is unknown); the user's own
 * group keeps its bare name.
 */
describe('repoHint', () => {
  it('is null for an item that joined a local group', () => {
    expect(toSharedSidebarItem(cloudItem(), LOCAL_REPOS, undefined).repoHint).toBeNull();
    expect(toArtifactsOnlySidebarItem(artifactsOnly(), LOCAL_REPOS).repoHint).toBeNull();
  });

  it("is the origin's owner/repo for an unmatched item with an origin", () => {
    const item = toSharedSidebarItem(
      cloudItem({ repo_remote_url: 'github.com/acme/billing', repo_name: 'billing' }),
      LOCAL_REPOS,
      undefined
    );
    expect(item.repoHint).toBe('acme/billing');
  });

  it('keeps every path segment after the host (nested groups)', () => {
    const item = toSharedSidebarItem(
      cloudItem({ repo_remote_url: 'gitlab.com/acme/platform/billing', repo_name: 'billing' }),
      LOCAL_REPOS,
      undefined
    );
    expect(item.repoHint).toBe('acme/platform/billing');
  });

  it('says the origin is unknown when the owner never sent one', () => {
    const item = toArtifactsOnlySidebarItem(artifactsOnly({ repo_remote_url: null }), LOCAL_REPOS);
    expect(item.repoHint).toBe('origin unknown');
  });
});

describe('group labels that clash', () => {
  function groupLabels(items: SidebarItem[]) {
    return projectSidebar({
      items,
      pinnedIds: [],
      options: { ...DEFAULT_SIDEBAR_OPTIONS, repoOrder: 'name' },
      view: 'repo',
      nowSeconds: 1_800_000_000,
    }).groups.map((group) => ({ label: group.label, tooltip: group.tooltip }));
  }

  it('leaves a label bare when no other group has it', () => {
    expect(
      groupLabels([
        toSharedSidebarItem(
          cloudItem({ repo_remote_url: 'github.com/acme/billing', repo_name: 'billing' }),
          LOCAL_REPOS,
          undefined
        ),
      ])
    ).toEqual([{ label: 'billing', tooltip: null }]);
  });

  it("suffixes the teammate's origin-less group beside the user's own group of that name", () => {
    expect(
      groupLabels([
        mine('own-1', 'r-kami', 'Kami'),
        toSharedSidebarItem(
          cloudItem({ id: 'shared-9', repo_remote_url: null, repo_name: 'Kami' }),
          LOCAL_REPOS,
          undefined
        ),
      ])
    ).toEqual([
      { label: 'Kami', tooltip: null },
      {
        label: 'Kami · origin unknown',
        tooltip: "The owner's copy never reported its origin. It joins your group once it does.",
      },
    ]);
  });

  it('suffixes two unmatched groups that share a name with their origins', () => {
    const labels = groupLabels([
      toSharedSidebarItem(
        cloudItem({ id: 's-a', repo_remote_url: 'github.com/one/api', repo_name: 'api' }),
        LOCAL_REPOS,
        undefined
      ),
      toSharedSidebarItem(
        cloudItem({ id: 's-b', repo_remote_url: 'github.com/two/api', repo_name: 'api' }),
        LOCAL_REPOS,
        undefined
      ),
    ]).map((group) => group.label);
    expect(labels.sort()).toEqual(['api · one/api', 'api · two/api']);
  });

  it('never suffixes status bands', () => {
    const projection = projectSidebar({
      items: [
        mine('own-1', 'r-kami', 'Kami'),
        toSharedSidebarItem(
          cloudItem({ id: 'shared-9', repo_remote_url: null, repo_name: 'Kami' }),
          LOCAL_REPOS,
          undefined
        ),
      ],
      pinnedIds: [],
      options: DEFAULT_SIDEBAR_OPTIONS,
      view: 'status',
      nowSeconds: 1_800_000_000,
    });
    expect(projection.groups.every((group) => group.tooltip === null)).toBe(true);
  });
});
