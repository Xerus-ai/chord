import { describe, expect, it } from 'vitest';
import { buildSessionEntries, type PublishableSessionRow } from './build-session-entries';

/**
 * Pure mapping tests. The builder lives apart from session-cloud-sync.ts for
 * the reason thread-digest records: anything importing the main-process db
 * client drags in better-sqlite3, which is built for Electron's ABI and
 * cannot load under vitest.
 */
function row(overrides: Partial<PublishableSessionRow> = {}): PublishableSessionRow {
  return {
    id: 'sess-1',
    kind: 'chat',
    agentProviderId: 'claude',
    title: 'Fix the parser',
    status: 'active',
    worktreeId: 'wt-1',
    lastActiveAt: 1_789_000_000,
    modelLabel: 'Opus 4.5',
    permissionModeLabel: 'Ask before edits',
    ...overrides,
  };
}

describe('buildSessionEntries', () => {
  it('maps a chat session onto the wire shape', () => {
    const [entry] = buildSessionEntries([row()]);
    expect(entry).toEqual({
      id: 'sess-1',
      agent_provider_id: 'claude',
      title: 'Fix the parser',
      status: 'active',
      worktree_id: 'wt-1',
      last_active_at: new Date(1_789_000_000 * 1000).toISOString(),
      // A teammate's composer shows these, disabled (user decision 2026-10-01).
      model_label: 'Opus 4.5',
      permission_mode_label: 'Ask before edits',
    });
  });

  it('publishes no shell terminals', () => {
    // A shell is not a shared conversation, and its title/cwd are the owner
    // machine's business. Filtered here rather than at the query so the rule
    // is visible and testable.
    const entries = buildSessionEntries([
      row({ id: 'chat', kind: 'chat' }),
      row({ id: 'shell', kind: 'shell' }),
    ]);
    expect(entries.map((e) => e.id)).toEqual(['chat']);
  });

  it('publishes done sessions — the registry reports what exists', () => {
    // Each client applies its own tab policy. A row that vanished from the
    // wire would be indistinguishable from one never published at all.
    const entries = buildSessionEntries([row({ status: 'done' })]);
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe('done');
  });

  it('carries nulls through rather than inventing placeholders', () => {
    const [entry] = buildSessionEntries([
      row({
        title: null,
        agentProviderId: null,
        worktreeId: null,
        modelLabel: null,
        permissionModeLabel: null,
      }),
    ]);
    expect(entry.title).toBeNull();
    expect(entry.agent_provider_id).toBeNull();
    expect(entry.worktree_id).toBeNull();
    expect(entry.model_label).toBeNull();
    expect(entry.permission_mode_label).toBeNull();
  });

  it('rejects a status outside the published vocabulary instead of shipping it', () => {
    // The local column is free text. A value the wire schema does not know
    // would be rejected by the route's zod parse as a 400 with no useful
    // context; failing here names the session.
    expect(() => buildSessionEntries([row({ status: 'provisioning' })])).toThrow(/sess-1/);
  });
});
