import type { CloudSession } from '@chord/protocol';
import { useEffect, useMemo } from 'react';
import { syncCloudSessionTabsInLayout } from './center-layout';
import { updateCenterLayout } from './center-tabs-store';
import { cloudSessionTabModel, type SessionTabModel } from './session-tab-model';

/**
 * A teammate's chat tabs follow the owner's published chats
 * (`syncCloudSessionTabsInLayout`; what was seen persists with the layout).
 * `sessions` undefined means the server did not send the registry: nothing is
 * known, so no tab is touched. Returns the chats by id, for the pane host and
 * the bodies.
 */
export function useCloudSessionTabs(
  layoutKey: string,
  sessions: readonly CloudSession[] | undefined
): ReadonlyMap<string, SessionTabModel> {
  useEffect(() => {
    if (!sessions) return;
    const sources = sessions.map((session) => ({
      ...cloudSessionTabModel(session),
      lastActiveAt: session.last_active_at,
    }));
    updateCenterLayout(layoutKey, (layout) => syncCloudSessionTabsInLayout(layout, sources));
  }, [layoutKey, sessions]);

  return useMemo(
    () => new Map((sessions ?? []).map((session) => [session.id, cloudSessionTabModel(session)])),
    [sessions]
  );
}
