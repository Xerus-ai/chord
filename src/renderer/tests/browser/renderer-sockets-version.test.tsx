/**
 * The renderer's two sockets to the sync server name the app's version in their
 * URL (devstation-mg6u.13): the server refuses an upgrade without it, so a
 * socket that drops it is sync or collaboration silently locked out. Real
 * Chromium; the sync socket provider and the collab hook run as the app runs
 * them, against the local stand-in the browser project starts
 * (cloud-api-stand-in.setup.ts), which records each upgrade's URL.
 *
 * Only the preload bridge is supplied: invoke answers a signed-in session and
 * an access token.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import packageJson from '../../../../package.json';

const SESSION = {
  user: { userId: 'user-vera', username: 'vera', email: 'vera@example.com', avatarUrl: '' },
  isSignedIn: true,
  hasAccount: true,
  authState: 'signed_in',
};

Object.assign(window, {
  electronAPI: {
    invoke: async (channel: string) => {
      if (channel === 'account.getSession') return SESSION;
      if (channel === 'account.getAccessToken') return 'test-token';
      return null;
    },
    eventOn: () => () => {},
    eventSend: () => {},
    getPathForFile: () => '',
  },
});

const { SyncSocketContextProvider } = await import('@renderer/lib/sync/sync-socket-provider');
const { useCollaboration } = await import('@renderer/features/artifacts/collaboration-provider');

const STAND_IN = import.meta.env.VITE_CLOUD_API_URL;
type Seen = { method: string; path: string; version: string | null };
const upgradesTo = async (path: string): Promise<Seen[]> =>
  ((await (await fetch(`${STAND_IN}/__seen`)).json()) as Seen[]).filter(
    (s) => s.method === 'UPGRADE' && s.path === path
  );

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
});

function render(node: React.ReactNode): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const client = new QueryClient();
  flushSync(() => root!.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>));
}

function CollabRoom({ serverUrl }: { serverUrl: string }) {
  useCollaboration({ roomId: 'artifact-version-probe', hasCloudCopy: true, serverUrl });
  return null;
}

describe('the renderer sockets name the app version', () => {
  it('the sync socket upgrades with chord_version', async () => {
    render(
      <SyncSocketContextProvider>
        <span />
      </SyncSocketContextProvider>
    );
    await vi.waitFor(async () => expect((await upgradesTo('/ws')).length).toBeGreaterThan(0), {
      timeout: 10_000,
    });
    for (const upgrade of await upgradesTo('/ws')) {
      expect(upgrade.version).toBe(packageJson.version);
    }
  });

  it('the collab provider connects with chord_version', async () => {
    render(<CollabRoom serverUrl={`${STAND_IN.replace(/^http/, 'ws')}/collab`} />);
    await vi.waitFor(async () => expect((await upgradesTo('/collab')).length).toBeGreaterThan(0), {
      timeout: 10_000,
    });
    for (const upgrade of await upgradesTo('/collab')) {
      expect(upgrade.version).toBe(packageJson.version);
    }
  });
});
