import { describe, expect, it } from 'vitest';
import { createDefaultPanelRule } from './default-panel-rule';

/**
 * The rail opens a work item on Changes while its tree is dirty, Work item
 * otherwise — once its state is known. A tab picked by hand before then used
 * to be overwritten when the state arrived: the sharing suite clicked Work item
 * on a freshly opened item and the rail moved to Changes under it.
 */
describe('createDefaultPanelRule', () => {
  it('opens a dirty work item on Changes once its state is known', () => {
    const rule = createDefaultPanelRule();
    expect(rule.decide({ workItemId: 'a', ready: false, isDirty: false, handPicks: 0 })).toBe(null);
    expect(rule.decide({ workItemId: 'a', ready: true, isDirty: true, handPicks: 0 })).toBe(
      'source-control'
    );
  });

  it('opens a clean work item on Work item', () => {
    const rule = createDefaultPanelRule();
    expect(rule.decide({ workItemId: 'a', ready: true, isDirty: false, handPicks: 0 })).toBe(
      'work-item'
    );
  });

  it('leaves a tab picked by hand before the state arrived', () => {
    const rule = createDefaultPanelRule();
    rule.decide({ workItemId: 'a', ready: false, isDirty: false, handPicks: 3 });
    expect(rule.decide({ workItemId: 'a', ready: true, isDirty: true, handPicks: 4 })).toBe(null);
  });

  it('applies once per work item, so a later change of state never moves the tab', () => {
    const rule = createDefaultPanelRule();
    rule.decide({ workItemId: 'a', ready: true, isDirty: false, handPicks: 0 });
    expect(rule.decide({ workItemId: 'a', ready: true, isDirty: true, handPicks: 0 })).toBe(null);
  });

  it('applies again to the next work item, counting picks from when it opened', () => {
    const rule = createDefaultPanelRule();
    rule.decide({ workItemId: 'a', ready: true, isDirty: false, handPicks: 0 });
    rule.decide({ workItemId: 'a', ready: true, isDirty: false, handPicks: 2 });
    expect(rule.decide({ workItemId: 'b', ready: true, isDirty: true, handPicks: 2 })).toBe(
      'source-control'
    );
  });
});
