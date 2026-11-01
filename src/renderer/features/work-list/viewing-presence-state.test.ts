import { describe, expect, it } from 'vitest';
import { artifactPathTab, filePathTab, ITEM_CHAT_TAB } from './center-tab';
import { presencePayload, presenceStateOf, type SessionKindOf } from './viewing-presence-state';

/**
 * One presence row per (user, work item), written by ONE sender per view from
 * the focused tab (shared-items step 4, decision 7). Before, the owner's diff,
 * file and artifact views each sent their own and the teammate view sent a
 * fourth: an artifact open in Diff advertised two files, and the later write
 * or the first unmount's clear won. A chat tab now counts as being in the work
 * item (the user's decision, 2026-09-28); a terminal does not.
 */
const kinds: SessionKindOf = (sessionId) =>
  sessionId === 's-chat' ? 'chat' : sessionId === 's-term' ? 'terminal' : undefined;

describe('presenceStateOf', () => {
  it('is the artifact surface for a focused artifact tab, in any mode', () => {
    expect(presenceStateOf(artifactPathTab('a-1', 'Plan'), kinds)).toEqual({
      file: 'artifact:a-1',
      view: 'artifact',
    });
    expect(
      presenceStateOf(
        artifactPathTab('a-1', 'Card', { filePath: 'src/card.tsx', mode: 'diff' }),
        kinds
      )
    ).toEqual({ file: 'artifact:a-1', view: 'artifact' });
  });

  it('is the path for a focused file, whichever way it is shown', () => {
    expect(presenceStateOf(filePathTab('src/app.ts', { mode: 'diff' }), kinds)).toEqual({
      file: 'src/app.ts',
      view: 'file',
    });
    expect(presenceStateOf(filePathTab('src/app.ts', { mode: 'edit' }), kinds)).toEqual({
      file: 'src/app.ts',
      view: 'file',
    });
    expect(presenceStateOf(filePathTab('README.md'), kinds)).toEqual({
      file: 'README.md',
      view: 'file',
    });
  });

  it('is the session for a focused chat tab', () => {
    expect(presenceStateOf({ kind: 'session', sessionId: 's-chat' }, kinds)).toEqual({
      file: 'session:s-chat',
      view: 'chat',
    });
  });

  it('is the item chat for the Work item chat tab, a chat like any other', () => {
    // Decision 7: being in a chat counts, including the no-chats Work item chat.
    expect(presenceStateOf(ITEM_CHAT_TAB, kinds)).toEqual({
      file: 'session:work-item-chat',
      view: 'chat',
    });
  });

  it('is no file for a terminal, an unknown session, a commit, or no tab', () => {
    const none = { file: null, view: 'work item' };
    expect(presenceStateOf({ kind: 'session', sessionId: 's-term' }, kinds)).toEqual(none);
    expect(presenceStateOf({ kind: 'session', sessionId: 's-gone' }, kinds)).toEqual(none);
    expect(presenceStateOf({ kind: 'commit', worktreeId: 'w', sha: 'abc' }, kinds)).toEqual(none);
    expect(presenceStateOf(null, kinds)).toEqual(none);
    expect(presenceStateOf(undefined, kinds)).toEqual(none);
  });
});

describe('presencePayload', () => {
  it('carries the file and a view people can read ("In chat" on the team pulse)', () => {
    expect(presencePayload('wi-1', { file: 'session:s-chat', view: 'chat' })).toEqual({
      work_item_id: 'wi-1',
      status: 'online',
      cursor_position: { file: 'session:s-chat' },
      active_view: 'chat',
    });
  });

  it('omits the cursor when nothing is viewed, so the server clears the stale file', () => {
    expect(presencePayload('wi-1', { file: null, view: 'work item' })).toEqual({
      work_item_id: 'wi-1',
      status: 'online',
      active_view: 'work item',
    });
  });
});
