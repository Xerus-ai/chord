import { describe, expect, it } from 'vitest';
import type { AgentSessionRow } from '@main/db/schema-work-items';
import { artifactPathTab, filePathTab, type CenterTab, type DocumentTab } from './center-tab';
import {
  isTabOffered,
  offersDocumentTo,
  participantLayoutKey,
  selectDocumentBody,
  type PaneHost,
  type PaneSessions,
} from './pane-host';
import { resolveWorkItemCapabilities } from './work-item-access';

const sessions: PaneSessions = {
  byId: new Map<string, AgentSessionRow>(),
  close: () => {},
  renderLauncher: () => null,
  emptyLabel: 'No conversations. Start one from +',
};
const owner = {
  offersDocument: offersDocumentTo(
    resolveWorkItemCapabilities({
      viewer: 'owner',
      role: 'edit',
      scope: 'work_item',
      approvalPolicy: 'owner',
    }),
    null
  ),
  sessions,
};
const participant = {
  offersDocument: offersDocumentTo(
    resolveWorkItemCapabilities({
      viewer: 'member',
      role: 'edit',
      scope: 'work_item',
      approvalPolicy: 'owner',
    }),
    null
  ),
  sessions: null,
};
const artifactsOnly = {
  offersDocument: offersDocumentTo(
    resolveWorkItemCapabilities({
      viewer: 'member',
      role: 'view',
      scope: 'artifacts',
      approvalPolicy: 'owner',
    }),
    new Set(['x'])
  ),
  sessions: null,
};

const session: CenterTab = { kind: 'session', sessionId: 's1' };
const file: DocumentTab = filePathTab('a.ts');
const diff: DocumentTab = filePathTab('a.ts', { mode: 'diff' });
const commit: DocumentTab = { kind: 'commit', worktreeId: 'w1', sha: 'abc' };
const artifact: DocumentTab = artifactPathTab('x', 'Spec');

describe('isTabOffered', () => {
  it('offers the owner every tab kind', () => {
    for (const tab of [session, file, diff, commit, artifact]) {
      expect(isTabOffered(owner, tab)).toBe(true);
    }
  });

  it('offers a participant diffs and artifacts only (no checkout to read files from)', () => {
    expect(isTabOffered(participant, diff)).toBe(true);
    expect(isTabOffered(participant, artifact)).toBe(true);
    expect(isTabOffered(participant, session)).toBe(false);
    expect(isTabOffered(participant, file)).toBe(false);
    expect(isTabOffered(participant, commit)).toBe(false);
  });
});

describe('offersDocumentTo', () => {
  it('offers someone reached through artifacts only the artifacts shared with them', () => {
    expect(isTabOffered(artifactsOnly, artifact)).toBe(true);
    expect(isTabOffered(artifactsOnly, artifactPathTab('y', 'Other'))).toBe(false);
    expect(isTabOffered(artifactsOnly, diff)).toBe(false);
    expect(isTabOffered(artifactsOnly, commit)).toBe(false);
  });

  it('needs the shared list exactly when artifact tabs are limited to it', () => {
    const caps = resolveWorkItemCapabilities({
      viewer: 'member',
      role: 'view',
      scope: 'artifacts',
      approvalPolicy: 'owner',
    });
    expect(() => offersDocumentTo(caps, null)).toThrow();
  });
});

describe('selectDocumentBody', () => {
  const context = { onDocumentTouched: () => {}, onClose: () => {}, onModeChange: () => {} };
  const host = (base: Pick<PaneHost, 'offersDocument' | 'sessions'>) => ({
    ...base,
    renderDocument: (tab: DocumentTab) =>
      `body:${tab.kind === 'path' ? (tab.artifactId ?? tab.mode ?? 'file') : tab.kind}`,
  });

  it('renders offered documents through the host', () => {
    expect(selectDocumentBody(host(participant), diff, context)).toBe('body:diff');
    expect(selectDocumentBody(host(owner), commit, context)).toBe('body:commit');
  });

  it('renders nothing for sessions, or kinds the view does not offer', () => {
    expect(selectDocumentBody(host(owner), session, context)).toBeNull();
    expect(selectDocumentBody(host(participant), file, context)).toBeNull();
    expect(selectDocumentBody(host(participant), commit, context)).toBeNull();
  });
});

describe('participantLayoutKey', () => {
  it('never collides with the owner layout, which is keyed by the id itself', () => {
    expect(participantLayoutKey('w1')).not.toBe('w1');
    expect(participantLayoutKey('w1')).toBe(participantLayoutKey('w1'));
  });
});
