import { describe, expect, it } from 'vitest';
import { scopedViewArtifactIds, scopedViewNotice } from './scoped-view';

const item = (names: string[]) => ({
  creator_name: 'Raghav' as string | null,
  creator_email: 'raghav@example.com',
  shared_artifacts: names.map((name, i) => ({ id: `art-${i + 1}`, name })),
});

/** The work item scoped to the artifacts shared with an artifacts-only viewer (step 4, S9). */
describe('scopedViewArtifactIds', () => {
  it('holds one artifact room per shared artifact, and no work item room', () => {
    expect([...scopedViewArtifactIds(item(['spec.md', 'hero.html']))]).toEqual(['art-1', 'art-2']);
  });
});

describe('scopedViewNotice', () => {
  it('says how many artifacts the viewer can see, and who shared them', () => {
    expect(scopedViewNotice(item(['spec.md']))).toBe(
      'You can see 1 artifact in this work item. Shared by Raghav.'
    );
    expect(scopedViewNotice(item(['a', 'b']))).toBe(
      'You can see 2 artifacts in this work item. Shared by Raghav.'
    );
  });

  it('names the owner by email when they have no name', () => {
    expect(scopedViewNotice({ ...item(['a']), creator_name: null })).toBe(
      'You can see 1 artifact in this work item. Shared by raghav@example.com.'
    );
  });
});
