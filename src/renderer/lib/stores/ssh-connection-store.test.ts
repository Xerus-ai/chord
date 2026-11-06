import { beforeEach, describe, expect, it } from 'vitest';
import { sshConnectionEventChannel } from '@shared/events/sshEvents';
import type { ConnectionState } from '@shared/ssh';
import { testMain } from '@renderer/lib/_testing/test-main';

/**
 * The store over the renderer's real RPC client and event bridge (`lib/ipc.ts`),
 * reaching a test main through the preload's `window.electronAPI` shape; the
 * store is imported once the test main is installed, since `lib/ipc.ts` reads
 * the bridge when it loads.
 */
const { SshConnectionStore } = await import('./ssh-connection-store');

/** What `ssh.getConnectionState` answers. */
let states: Record<string, ConnectionState>;

beforeEach(() => {
  states = {};
  testMain.reset();
  testMain.serve({
    ssh: {
      getConnections: () => [],
      getConnectionState: () => states,
    },
  });
});

describe('SshConnectionStore', () => {
  it('notifies when an SSH connection becomes ready', () => {
    const ready: string[] = [];
    const store = new SshConnectionStore({ onConnectionReady: (id) => ready.push(id) });
    store.start();

    for (const type of ['connected', 'reconnected', 'disconnected'] as const) {
      testMain.send(sshConnectionEventChannel.name, { type, connectionId: 'ssh-1' });
    }

    expect(ready).toEqual(['ssh-1', 'ssh-1']);
  });

  it('notifies for initially connected SSH connections', async () => {
    states = { 'ssh-1': 'connected', 'ssh-2': 'disconnected' };
    const ready: string[] = [];
    const store = new SshConnectionStore({ onConnectionReady: (id) => ready.push(id) });

    store.start();
    await store.connectionStatesResource.load();

    expect(ready).toContain('ssh-1');
    expect(ready).not.toContain('ssh-2');
    expect(testMain.calls('ssh.getConnectionState').length).toBeGreaterThan(0);
  });
});
