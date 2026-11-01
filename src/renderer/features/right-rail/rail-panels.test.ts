import { describe, expect, it } from 'vitest';
import { railTabs, resolveRailPanel } from './rail-panels';

const TEAMMATE = ['work-item', 'source-control', 'checks-pr'] as const;
const OWNER = ['work-item', 'source-control', 'explorer', 'checks-pr', 'run'] as const;

/** Which rail tabs a viewer sees, and where a stored choice lands (step 4, S7). */
describe('railTabs', () => {
  it("lists the viewer's panels in the manifest's order", () => {
    expect(railTabs(OWNER).map((t) => t.id)).toEqual([
      'work-item',
      'source-control',
      'explorer',
      'checks-pr',
      'run',
    ]);
  });

  it('labels the run panel Run, last in the strip', () => {
    expect(railTabs(OWNER).at(-1)).toEqual({ id: 'run', label: 'Run' });
  });

  it('leaves out a panel the viewer cannot use, rather than greying it', () => {
    expect(railTabs(TEAMMATE).map((t) => t.label)).toEqual(['Work item', 'Changes', 'Checks']);
  });
});

describe('resolveRailPanel', () => {
  it('keeps the stored panel when the viewer has it', () => {
    expect(resolveRailPanel('checks-pr', TEAMMATE)).toBe('checks-pr');
  });

  it('falls to Work item from a panel the viewer does not have, for any viewer', () => {
    // The rail's panel is stored once for the app: a teammate arriving with
    // Files chosen in an owner view must not open to a panel they lack.
    expect(resolveRailPanel('explorer', TEAMMATE)).toBe('work-item');
    expect(resolveRailPanel('explorer', ['work-item'])).toBe('work-item');
  });
});
