import { describe, expect, it } from 'vitest';
import type { WorkItemImportableSessions } from '@shared/session-import';
import { selectFoundSessionsNotes } from './found-sessions-notes-model';

/**
 * "Sessions from Gemini, Droid can't be imported…" sat under the Worktrees of
 * every work item, a brand-new one included, and in every history-e2e
 * screenshot (devstation-6re). A note on what the import list leaves out
 * belongs where the list offers something; a source that failed to list is an
 * error and is always said.
 */
const empty: WorkItemImportableSessions = { lanes: [], failures: [], unsupported: [] };
const offering: WorkItemImportableSessions = {
  ...empty,
  lanes: [
    {
      worktreeId: 'lane-1',
      sessions: [
        {
          providerId: 'claude',
          providerSessionId: 'abc',
          title: 'Fix the login',
          lastActivityAt: null,
        } as WorkItemImportableSessions['lanes'][number]['sessions'][number],
      ],
    },
  ],
};
const installed = new Set(['claude', 'gemini', 'droid']);

describe('selectFoundSessionsNotes', () => {
  it('says nothing about agents that cannot import when nothing is offered', () => {
    expect(
      selectFoundSessionsNotes(
        { ...empty, unsupported: [{ providerId: 'goose', reason: 'no_session_list' }] },
        installed
      )
    ).toEqual({ failures: [], unsupported: [], terminalOnly: [] });
  });

  it('names the terminal-only and unsupported agents beside sessions it offers', () => {
    const notes = selectFoundSessionsNotes(
      { ...offering, unsupported: [{ providerId: 'goose', reason: 'no_session_list' }] },
      installed
    );

    expect(notes.terminalOnly).toEqual(expect.arrayContaining(['Gemini', 'Droid']));
    expect(notes.unsupported).toHaveLength(1);
  });

  it('always reports a source that failed to list', () => {
    const failure = { providerId: 'codex' as const, message: 'app-server exited' };

    expect(selectFoundSessionsNotes({ ...empty, failures: [failure] }, installed).failures).toEqual(
      [failure]
    );
  });
});
