import { describe, expect, it } from 'vitest';
import { sharePeopleRows } from './share-people-rows';
import type { SharingState } from './sharing-api';

const AUTHOR = {
  user_id: 'u-raghav',
  email: 'raghav@example.com',
  name: 'Raghav',
  avatar_url: null,
};
const MAYA = {
  id: 'm-maya',
  user_id: 'u-maya',
  email: 'maya@example.com',
  name: 'Maya',
  avatar_url: null,
  role: 'edit' as const,
  pending: false,
};
const KADEN = {
  ...MAYA,
  id: 'm-kaden',
  user_id: 'u-kaden',
  email: 'kaden@example.com',
  name: 'Kaden',
  role: 'view' as const,
};

function state(overrides: Partial<SharingState>): SharingState {
  return {
    caller_role: 'author',
    author: AUTHOR,
    team: { id: 'org-1', name: 'Kami' },
    general_access: 'invited',
    general_role: 'view',
    members: [],
    artifact_members: [],
    team_allows_public_links: true,
    link: null,
    work_item: null,
    ...overrides,
  };
}

/**
 * "People with access" in the Share dialog (shared-items design §5): the
 * author, the members of what is being shared, and, per scope, the people
 * who reach it another way: through the work item, or through some of its
 * artifacts only.
 */
describe('sharePeopleRows', () => {
  it('lists the author, then the work item members, then who holds only artifacts', () => {
    const rows = sharePeopleRows(
      state({
        members: [MAYA],
        artifact_members: [
          {
            user_id: 'u-kaden',
            email: 'kaden@example.com',
            name: 'Kaden',
            avatar_url: null,
            pending: false,
            artifacts: [
              { member_id: 'am-1', artifact_id: 'a1', artifact_name: 'spec.md', role: 'view' },
            ],
          },
        ],
      })
    );
    expect(rows.map((row) => [row.kind, row.email])).toEqual([
      ['author', 'raghav@example.com'],
      ['member', 'maya@example.com'],
      ['artifacts_only', 'kaden@example.com'],
    ]);
    expect(rows[2]).toMatchObject({ tag: '1 artifact', firstArtifactId: 'a1' });
  });

  it("in an artifact's scope, adds who reaches it through the work item, read-only", () => {
    const rows = sharePeopleRows(
      state({
        members: [KADEN],
        work_item: {
          id: 'w1',
          name: 'Landing page copy',
          general_access: 'invited',
          general_role: 'view',
          members: [MAYA, KADEN],
        },
      })
    );
    expect(rows.map((row) => [row.kind, row.email])).toEqual([
      ['author', 'raghav@example.com'],
      ['member', 'kaden@example.com'],
      ['via_work_item', 'maya@example.com'],
    ]);
    expect(rows[2]).toMatchObject({ tag: 'via work item', role: 'edit' });
  });

  it('counts artifacts in the tag', () => {
    const rows = sharePeopleRows(
      state({
        artifact_members: [
          {
            user_id: 'u-kaden',
            email: 'kaden@example.com',
            name: 'Kaden',
            avatar_url: null,
            pending: false,
            artifacts: [
              { member_id: 'am-1', artifact_id: 'a1', artifact_name: 'spec.md', role: 'view' },
              { member_id: 'am-2', artifact_id: 'a2', artifact_name: 'hero.html', role: 'edit' },
            ],
          },
        ],
      })
    );
    expect(rows[1]).toMatchObject({ kind: 'artifacts_only', tag: '2 artifacts' });
  });
});
