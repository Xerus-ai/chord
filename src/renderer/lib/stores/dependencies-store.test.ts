import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import type {
  DependencyInstallResult,
  DependencyState,
  DependencyStatusMap,
} from '@shared/dependencies';
import { dependencyStatusUpdatedChannel } from '@shared/events/appEvents';
import { err, ok } from '@shared/result';
import { testMain } from '@renderer/lib/_testing/test-main';

/**
 * The store over the renderer's real RPC client and event bridge (`lib/ipc.ts`),
 * reaching a test main through the preload's `window.electronAPI` shape. The
 * test main serves a dependencies controller whose answers each case sets.
 * `lib/ipc.ts` reads the bridge when it loads, so the store is imported after
 * the test main is installed.
 */
const { DependenciesStore } = await import('./dependencies-store');

/** What `dependencies.getAll` answers, per connection (`local` for this machine). */
let statuses: Record<string, DependencyStatusMap>;
/** What each `dependencies.install` answers, in order. */
let installs: (DependencyInstallResult | Promise<DependencyInstallResult>)[];

function availableAgent(id: AgentProviderId): DependencyState {
  return {
    id,
    category: 'agent' as const,
    status: 'available' as const,
    version: '1.0.0',
    path: `/bin/${id}`,
    checkedAt: 1,
  };
}

beforeEach(() => {
  statuses = {};
  installs = [];
  testMain.reset();
  testMain.serve({
    dependencies: {
      getAll: (connectionId?: string) => statuses[connectionId ?? 'local'] ?? {},
      install: (id: string) => {
        const next = installs.shift();
        if (!next) throw new Error(`the test queued no install result for ${id}`);
        return next;
      },
      probeAll: () => undefined,
      probeCategory: () => undefined,
    },
  });
});

describe('DependenciesStore install', () => {
  it('updates local dependency state after a local install', async () => {
    installs.push(ok(availableAgent('codex')));
    statuses.local = { codex: availableAgent('codex') };
    const store = new DependenciesStore();

    const result = await store.install('codex');

    expect(result.success).toBe(true);
    expect(testMain.calls('dependencies.install')).toEqual([['codex', undefined]]);
    expect(testMain.calls('dependencies.probeCategory')).toEqual([['agent', undefined]]);
    expect(store.local.data?.codex?.status).toBe('available');
  });

  it('does not update local dependency state after a failed install result', async () => {
    installs.push(
      err({
        type: 'permission-denied' as const,
        message: 'User does not have sufficient permissions.',
        output: 'permission denied',
        exitCode: 243,
      })
    );
    statuses.local = { codex: availableAgent('codex') };
    const store = new DependenciesStore();

    const result = await store.install('codex');

    expect(result.success).toBe(false);
    expect(testMain.calls('dependencies.getAll')).toEqual([]);
    expect(store.local.data?.codex).toBeUndefined();
  });

  it('updates remote dependency state after a remote install', async () => {
    installs.push(ok(availableAgent('claude')));
    statuses['ssh-1'] = { claude: availableAgent('claude') };
    const store = new DependenciesStore();
    const remote = store.getRemote('ssh-1');
    remote.setValue({});

    await store.install('claude', 'ssh-1');

    expect(testMain.calls('dependencies.install')).toEqual([['claude', 'ssh-1']]);
    expect(remote.data?.claude?.status).toBe('available');
    expect(store.local.data?.claude).toBeUndefined();
  });

  it('preserves existing remote dependency state after a remote install', async () => {
    installs.push(ok(availableAgent('claude')));
    statuses['ssh-1'] = { codex: availableAgent('codex'), claude: availableAgent('claude') };
    const store = new DependenciesStore();
    const remote = store.getRemote('ssh-1');
    remote.setValue({ codex: availableAgent('codex') });

    await store.install('claude', 'ssh-1');

    expect(remote.data?.codex?.status).toBe('available');
    expect(remote.data?.claude?.status).toBe('available');
  });

  it('refreshes all remote agent states after an install when the remote state was unknown', async () => {
    installs.push(ok(availableAgent('claude')));
    statuses['ssh-1'] = { codex: availableAgent('codex'), claude: availableAgent('claude') };
    const store = new DependenciesStore();

    await store.install('claude', 'ssh-1');

    expect(testMain.calls('dependencies.probeCategory')).toEqual([['agent', 'ssh-1']]);
    expect(testMain.calls('dependencies.getAll')).toEqual([['ssh-1']]);
    expect(store.getRemote('ssh-1').data?.codex?.status).toBe('available');
    expect(store.getRemote('ssh-1').data?.claude?.status).toBe('available');
  });

  it('refreshes an existing remote dependency resource on reconnect', async () => {
    statuses['ssh-1'] = { codex: availableAgent('codex'), claude: availableAgent('claude') };
    const store = new DependenciesStore();
    const remote = store.getRemote('ssh-1');
    remote.setValue({ codex: availableAgent('codex') });

    await store.refreshAgents('ssh-1');

    expect(testMain.calls('dependencies.probeCategory')).toEqual([['agent', 'ssh-1']]);
    expect(remote.data?.codex?.status).toBe('available');
    expect(remote.data?.claude?.status).toBe('available');
  });

  it('creates and refreshes a remote dependency resource on reconnect', async () => {
    statuses['ssh-1'] = { codex: availableAgent('codex'), claude: availableAgent('claude') };
    const store = new DependenciesStore();

    await store.refreshAgents('ssh-1');

    expect(testMain.calls('dependencies.probeCategory')).toEqual([['agent', 'ssh-1']]);
    expect(store.getRemote('ssh-1').data?.codex?.status).toBe('available');
    expect(store.getRemote('ssh-1').data?.claude?.status).toBe('available');
  });

  it('applies streamed remote dependency events to the matching remote resource', () => {
    const store = new DependenciesStore();
    store.start();

    testMain.send(dependencyStatusUpdatedChannel.name, {
      id: 'claude',
      connectionId: 'ssh-1',
      state: availableAgent('claude'),
    });

    expect(store.getRemote('ssh-1').data?.claude?.status).toBe('available');
    expect(store.local.data?.claude).toBeUndefined();
    store.dispose();
  });

  it('tracks in-flight installs by dependency and connection', async () => {
    let resolveInstall!: (value: DependencyInstallResult) => void;
    installs.push(new Promise<DependencyInstallResult>((resolve) => (resolveInstall = resolve)));
    statuses['ssh-1'] = { codex: availableAgent('codex') };
    const store = new DependenciesStore();

    const install = store.install('codex', 'ssh-1');

    expect(store.isInstalling('codex', 'ssh-1')).toBe(true);
    expect(store.isInstalling('codex')).toBe(false);

    resolveInstall(ok(availableAgent('codex')));
    await install;

    expect(store.isInstalling('codex', 'ssh-1')).toBe(false);
  });
});
