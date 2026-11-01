import { describe, expect, it } from 'vitest';
import type { ArtifactVersion } from './use-versions';
import { describeVersionReason, groupVersionsByDay } from './version-history';

function version(n: number, trigger: string, createdAt: Date, label?: string): ArtifactVersion {
  return {
    id: `v${n}`,
    version_number: n,
    trigger,
    label: label ?? null,
    author_name: 'Maya',
    created_at: createdAt.toISOString(),
  };
}

const now = new Date();
const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
const lastMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

describe('describeVersionReason', () => {
  it('names why a version exists, and a label wins', () => {
    expect(describeVersionReason(version(1, 'manual', now))).toBe('Saved');
    expect(describeVersionReason(version(2, 'agent_milestone', now))).toBe('Agent update');
    expect(describeVersionReason(version(3, 'auto', now))).toBe('Auto-saved');
    expect(describeVersionReason(version(4, 'manual', now, 'Restored v1'))).toBe('Restored v1');
  });
});

describe('groupVersionsByDay', () => {
  it('keeps newest-first order and starts a group at each new day', () => {
    const groups = groupVersionsByDay([
      version(4, 'manual', now),
      version(3, 'manual', now),
      version(2, 'agent_milestone', yesterday),
      version(1, 'manual', lastMonth),
    ]);
    expect(groups.map((g) => [g.day, g.versions.map((v) => v.version_number)])).toEqual([
      ['Today', [4, 3]],
      ['Yesterday', [2]],
      ['Earlier', [1]],
    ]);
  });

  it('is empty for no versions', () => {
    expect(groupVersionsByDay([])).toEqual([]);
  });
});
