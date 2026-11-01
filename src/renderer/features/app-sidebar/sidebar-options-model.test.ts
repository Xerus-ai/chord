import { describe, expect, it } from 'vitest';
import {
  countActiveOptions,
  DEFAULT_SIDEBAR_OPTIONS,
  normalizeSidebarOptions,
} from './sidebar-options-model';

describe('countActiveOptions', () => {
  it('counts nothing when every option sits at its default', () => {
    expect(countActiveOptions(DEFAULT_SIDEBAR_OPTIONS)).toBe(0);
  });

  it('counts a repo scope, whatever its size', () => {
    expect(countActiveOptions({ ...DEFAULT_SIDEBAR_OPTIONS, visibleRepoIds: ['a', 'b'] })).toBe(1);
  });

  it('counts each non-default choice, filter, and property once', () => {
    const options = {
      ...DEFAULT_SIDEBAR_OPTIONS,
      sortBy: 'name' as const,
      rowLayout: 'detailed' as const,
      filters: { ...DEFAULT_SIDEBAR_OPTIONS.filters, hideDone: true },
      properties: { ...DEFAULT_SIDEBAR_OPTIONS.properties, diffStat: false },
    };
    expect(countActiveOptions(options)).toBe(4);
  });

  it('never counts a view choice — the view is not an option', () => {
    expect(countActiveOptions({ ...DEFAULT_SIDEBAR_OPTIONS, ...{ groupBy: 'status' } })).toBe(0);
  });
});

describe('normalizeSidebarOptions', () => {
  it('returns the defaults for a missing snapshot', () => {
    expect(normalizeSidebarOptions(null)).toEqual(DEFAULT_SIDEBAR_OPTIONS);
    expect(normalizeSidebarOptions('nonsense')).toEqual(DEFAULT_SIDEBAR_OPTIONS);
  });

  it('fills options a stored snapshot predates', () => {
    const restored = normalizeSidebarOptions({ rowLayout: 'detailed' });
    expect(restored.rowLayout).toBe('detailed');
    expect(restored.sortBy).toBe(DEFAULT_SIDEBAR_OPTIONS.sortBy);
    expect(restored.filters).toEqual(DEFAULT_SIDEBAR_OPTIONS.filters);
  });

  it('ignores a stale group-by an older build wrote, without leaking the key', () => {
    const restored = normalizeSidebarOptions({ groupBy: 'status', sortBy: 'name' });
    expect(restored).toEqual({ ...DEFAULT_SIDEBAR_OPTIONS, sortBy: 'name' });
    expect('groupBy' in restored).toBe(false);
  });

  it('drops a value no data can answer, rather than restoring a dead view', () => {
    expect(normalizeSidebarOptions({ repoOrder: 'manual' }).repoOrder).toBe('recent');
    expect(normalizeSidebarOptions({ agentSessions: 'full' }).agentSessions).toBe('live');
  });

  it('forces unsupported properties and filters off even when stored on', () => {
    const restored = normalizeSidebarOptions({
      properties: { ticket: true, diffStat: false },
      filters: { hideArchivedWorktrees: true, hideDone: true },
    });
    expect(restored.properties.ticket).toBe(false);
    expect(restored.properties.diffStat).toBe(false);
    expect(restored.filters.hideArchivedWorktrees).toBe(false);
    expect(restored.filters.hideDone).toBe(true);
  });

  it('rejects a value outside the union', () => {
    expect(normalizeSidebarOptions({ sortBy: 'whatever' }).sortBy).toBe('attention');
    expect(normalizeSidebarOptions({ visibleRepoIds: [1, 'a'] }).visibleRepoIds).toEqual(['a']);
  });
});
