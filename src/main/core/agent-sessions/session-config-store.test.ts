import { eq, like } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { buildClaudeCatalog } from '@shared/agent-control-catalog';
import { CODEX_MODELS } from '@main/core/codex-app-server/codex-captured-messages';
import { buildCodexCatalog } from '@main/core/codex-app-server/codex-catalog';

// Real SQLite built from the shipped migrations (see `migrated-test-db.ts`):
// overrides round-trip through the real `kv` and `agent_sessions` tables.
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { db } = await import('@main/db/client');
const { kv } = await import('@main/db/schema');
const { agentSessions, repos, workItems } = await import('@main/db/schema-work-items');

async function insertSession(id: string, status: string): Promise<void> {
  await db.insert(agentSessions).values({
    id,
    workItemId: 'w-1',
    kind: 'chat',
    agentProviderId: 'codex',
    communication: 'acp',
    status,
  });
}

function storeOverride(sessionId: string, config: object): void {
  db.insert(kv)
    .values({ key: `session-config:${sessionId}`, value: JSON.stringify(config), updatedAt: 0 })
    .run();
}

function readStoredOverride(sessionId: string): unknown {
  const row = db
    .select({ value: kv.value })
    .from(kv)
    .where(eq(kv.key, `session-config:${sessionId}`))
    .get();
  return row ? JSON.parse(row.value) : undefined;
}

// What an earlier app run left behind: one live session's override, one for a
// session since retired, and one whose session row is gone.
await db.insert(repos).values({ id: 'r-1', alias: 'chord', path: '/tmp/chord' });
await db.insert(workItems).values({ id: 'w-1', repoId: 'r-1', repoPath: '/tmp/chord', name: 'W' });
await insertSession('s-stored', 'suspended');
await insertSession('s-ended', 'done');
storeOverride('s-stored', { effort: 'xhigh' });
storeOverride('s-ended', { effort: 'low' });
storeOverride('s-gone', { effort: 'low' });

const {
  clearChatSessionConfig,
  getChatSessionConfig,
  launchConfigChanged,
  resolveChatLaunchConfig,
  setChatSessionConfig,
} = await import('./session-config-store');

const item = { model: 'gpt-5.5', effort: 'high' };
const codex = buildCodexCatalog(CODEX_MODELS);
const claude = buildClaudeCatalog([
  {
    value: 'opus[1m]',
    displayName: 'Opus (1M context)',
    description: 'Opus 5 with 1M context',
    supportedEffortLevels: ['low', 'high', 'max'],
    supportsFastMode: true,
  },
  { value: 'haiku', displayName: 'Haiku', description: 'Haiku 4.5' },
]);

describe('session-config-store', () => {
  it('loads stored overrides on first use, dropping those of ended sessions', () => {
    expect(getChatSessionConfig('s-stored')).toEqual({ effort: 'xhigh' });
    expect(getChatSessionConfig('s-ended')).toEqual({});
    expect(getChatSessionConfig('s-gone')).toEqual({});
    const keys = db.select({ key: kv.key }).from(kv).where(like(kv.key, 'session-config:%')).all();
    expect(keys.map((row) => row.key)).toEqual(['session-config:s-stored']);
  });

  it('loads once: a row written behind its back is not read', async () => {
    await insertSession('s-late', 'active');
    storeOverride('s-late', { effort: 'low' });
    expect(getChatSessionConfig('s-late')).toEqual({});
  });

  it('writes every change through and deletes on clear', () => {
    setChatSessionConfig('s-saved', { model: 'gpt-6-astra' });
    setChatSessionConfig('s-saved', { effort: 'low' });
    expect(readStoredOverride('s-saved')).toEqual({ model: 'gpt-6-astra', effort: 'low' });
    clearChatSessionConfig('s-saved');
    expect(readStoredOverride('s-saved')).toBeUndefined();
    expect(getChatSessionConfig('s-saved')).toEqual({});
  });

  it('falls back to the work item for a session with no override', () => {
    expect(getChatSessionConfig('s-none')).toEqual({});
    expect(resolveChatLaunchConfig(codex, item, 's-none')).toEqual({
      model: 'gpt-5.5',
      effort: 'high',
      fast: false,
    });
  });

  it('scopes an override to that session only', () => {
    setChatSessionConfig('s-a', { model: 'gpt-6-astra', effort: 'low' });
    expect(resolveChatLaunchConfig(codex, item, 's-a')).toEqual({
      model: 'gpt-6-astra',
      effort: 'low',
      fast: false,
    });
    expect(resolveChatLaunchConfig(codex, item, 's-b')).toEqual({
      model: 'gpt-5.5',
      effort: 'high',
      fast: false,
    });
  });

  it('merges patches and falls back per field', () => {
    setChatSessionConfig('s-partial', { effort: 'medium' });
    expect(resolveChatLaunchConfig(codex, item, 's-partial')).toEqual({
      model: 'gpt-5.5',
      effort: 'medium',
      fast: false,
    });
    setChatSessionConfig('s-partial', { model: 'gpt-6-astra' });
    expect(getChatSessionConfig('s-partial')).toEqual({ model: 'gpt-6-astra', effort: 'medium' });
  });

  it('treats an explicit null model as the provider default, not a fallback', () => {
    setChatSessionConfig('s-null', { model: null });
    expect(resolveChatLaunchConfig(codex, item, 's-null').model).toBeNull();
  });

  it('resolves a model from another provider to the provider default', () => {
    setChatSessionConfig('s-stale', { model: 'gpt-6-astra' });
    expect(resolveChatLaunchConfig(claude, undefined, 's-stale').model).toBeNull();
  });

  it('keeps fast only on a model that supports it', () => {
    setChatSessionConfig('s-fast', { model: 'opus[1m]', fast: true });
    expect(resolveChatLaunchConfig(claude, undefined, 's-fast').fast).toBe(true);
    setChatSessionConfig('s-fast', { model: 'haiku' });
    expect(getChatSessionConfig('s-fast')).toEqual({ model: 'haiku', fast: true });
    expect(resolveChatLaunchConfig(claude, undefined, 's-fast').fast).toBe(false);
  });

  it('a work item change shows through a session without an override', () => {
    const changed = { model: 'gpt-6-astra', effort: 'low' };
    expect(
      launchConfigChanged(
        resolveChatLaunchConfig(codex, item, 's-room'),
        resolveChatLaunchConfig(codex, changed, 's-room')
      )
    ).toBe(true);
  });
});

describe('launchConfigChanged', () => {
  const launch = { model: 'gpt-6-astra', effort: 'low', fast: false };

  it('is false without a recorded launch', () => {
    expect(launchConfigChanged(undefined, { model: null, effort: null, fast: false })).toBe(false);
  });

  it('is false when the launch matches', () => {
    expect(launchConfigChanged(launch, { model: 'gpt-6-astra', effort: 'low', fast: false })).toBe(
      false
    );
  });

  it('is true when model, effort or fast differs', () => {
    expect(launchConfigChanged(launch, { model: 'gpt-5.5', effort: 'low', fast: false })).toBe(
      true
    );
    expect(launchConfigChanged(launch, { model: 'gpt-6-astra', effort: 'high', fast: false })).toBe(
      true
    );
    expect(launchConfigChanged(launch, { model: 'gpt-6-astra', effort: 'low', fast: true })).toBe(
      true
    );
  });
});
