import { describe, expect, it } from 'vitest';
import {
  createCenterLayout,
  getFocusedPane,
  openTabInLayout,
  syncSessionTabsInLayout,
} from './center-layout';
import { keepSessionsOnLiveLanes } from './sessions-on-live-lanes';

/**
 * Archiving a lane while its chat tab was active left that tab active, with a
 * transcript and a composer that looked usable, though the lane's checkout
 * was gone (devstation-lf5i). A session on an archived lane is not one the
 * centre strip shows: its tab goes and the strip falls back to another, as for
 * a session that no longer exists. Restore brings the lane back, and its chat
 * opens from the rail.
 */
const chat = (id: string, worktreeId: string | null) => ({
  id,
  kind: 'chat' as const,
  status: 'suspended',
  worktreeId,
});

describe('keepSessionsOnLiveLanes', () => {
  it('keeps sessions on live lanes and those with no lane, and drops the rest', () => {
    const sessions = [chat('s-primary', 'lane-1'), chat('s-old', null), chat('s-fork', 'lane-2')];

    expect(
      keepSessionsOnLiveLanes(sessions, new Set(['lane-1'])).map((session) => session.id)
    ).toEqual(['s-primary', 's-old']);
  });

  it("closes an archived lane's chat tab and shows another", () => {
    const both = [chat('s-primary', 'lane-1'), chat('s-fork', 'lane-2')];
    const opened = openTabInLayout(
      openTabInLayout(
        createCenterLayout(),
        { kind: 'session', sessionId: 's-primary' },
        { preview: false }
      ),
      { kind: 'session', sessionId: 's-fork' },
      { preview: false }
    );
    expect(getFocusedPane(syncSessionTabsInLayout(opened, both)).active).toEqual({
      kind: 'session',
      sessionId: 's-fork',
    });

    const archived = syncSessionTabsInLayout(
      opened,
      keepSessionsOnLiveLanes(both, new Set(['lane-1']))
    );

    const pane = getFocusedPane(archived);
    expect(pane.tabs).toEqual([{ kind: 'session', sessionId: 's-primary' }]);
    expect(pane.active).toEqual({ kind: 'session', sessionId: 's-primary' });
  });
});
