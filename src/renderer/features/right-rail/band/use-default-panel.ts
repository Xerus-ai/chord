import { useEffect, useState } from 'react';
import { useRailStore } from '../rail-store';
import { createDefaultPanelRule } from './default-panel-rule';

/** Opens a work item on its default tab (`createDefaultPanelRule`). */
export function useDefaultPanel(workItemId: string, isDirty: boolean, ready: boolean): void {
  const selectPanel = useRailStore((state) => state.selectPanel);
  const handPicks = useRailStore((state) => state.handPicks);
  const [rule] = useState(createDefaultPanelRule);

  useEffect(() => {
    const panel = rule.decide({ workItemId, ready, isDirty, handPicks });
    // `selectPanel`, not `activate`: that one is the shortcut's toggle, and
    // would close the rail when the default matches the open tab.
    if (panel) selectPanel(panel);
  }, [rule, workItemId, isDirty, ready, handPicks, selectPanel]);
}
