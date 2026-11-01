import { describe, expect, it } from 'vitest';
import { filePathTab, type StripTab } from './center-tab';
import { indexOfActiveTab, nextTab, previousTab, tabAtIndex } from './center-tab-strip-order';

const fileTab: StripTab = filePathTab('src/a.ts');
const sessionTab: StripTab = { kind: 'session', sessionId: 's1' };
const tabs: StripTab[] = [fileTab, sessionTab];

describe('indexOfActiveTab', () => {
  it('finds the active tab by value equality', () => {
    expect(indexOfActiveTab(tabs, { kind: 'session', sessionId: 's1' })).toBe(1);
  });

  it('returns -1 for a tab no longer in the strip', () => {
    expect(indexOfActiveTab(tabs, { kind: 'session', sessionId: 'gone' })).toBe(-1);
  });

  // A pane showing its empty state has no active tab at all — the state the
  // pinned Room tab used to stand in for.
  it('returns -1 when the pane has nothing active', () => {
    expect(indexOfActiveTab(tabs, null)).toBe(-1);
  });
});

describe('nextTab', () => {
  it('advances to the next tab', () => {
    expect(nextTab(tabs, fileTab)).toEqual(sessionTab);
  });

  it('wraps from the last tab back to the first', () => {
    expect(nextTab(tabs, sessionTab)).toEqual(fileTab);
  });

  it('falls back to the first tab when active is stale', () => {
    expect(nextTab(tabs, { kind: 'session', sessionId: 'gone' })).toEqual(fileTab);
  });

  it('selects the first tab from an empty pane', () => {
    expect(nextTab(tabs, null)).toEqual(fileTab);
  });

  it('has nothing to advance to in an empty strip', () => {
    expect(nextTab([], null)).toBeUndefined();
  });
});

describe('previousTab', () => {
  it('goes back to the previous tab', () => {
    expect(previousTab(tabs, sessionTab)).toEqual(fileTab);
  });

  it('wraps from the first tab to the last', () => {
    expect(previousTab(tabs, fileTab)).toEqual(sessionTab);
  });
});

describe('tabAtIndex', () => {
  it('returns the tab at a strip position', () => {
    expect(tabAtIndex(tabs, 0)).toEqual(fileTab);
    expect(tabAtIndex(tabs, 1)).toEqual(sessionTab);
  });

  it('returns undefined past the end', () => {
    expect(tabAtIndex(tabs, 9)).toBeUndefined();
  });
});
