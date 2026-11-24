/**
 * Two notes that tell the user why something will not work, in real Chromium.
 * The bugs these catch: sign-in that looks the same whether or not the sync
 * server answered the version check (a launch with the server down looked like
 * a working one), and a build with no updater that Settings reported as
 * "up to date".
 *
 * Only the preload bridge is supplied: invoke answers the version verdict and
 * the public URLs the sign-in screen reads.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopCompatibility } from '@shared/desktop-compatibility';
import '@renderer/index.css';

let verdict: DesktopCompatibility = { state: 'unknown', checked: false, reason: 'not checked yet' };
let bootCheck: { success: true; result: null; active: boolean } = {
  success: true,
  result: null,
  active: true,
};

Object.assign(window, {
  electronAPI: {
    invoke: async (channel: string) => {
      if (channel === 'app.getDesktopCompatibility') return verdict;
      if (channel === 'app.getPublicUrls') return { terms: null, privacy: null };
      if (channel === 'update.check') return bootCheck;
      if (channel === 'app.getAppVersion') return '0.1.0';
      throw new Error(`the screen asked the main process for ${channel}`);
    },
    eventOn: () => () => {},
    eventSend: () => {},
    getPathForFile: () => '',
  },
});

document.documentElement.classList.add('chord-light');

const { AuthGate } = await import('@renderer/features/auth/auth-gate');
const { UpdateCard } = await import('@renderer/features/settings/components/UpdateCard');
const { useUpdateStore } = await import('@renderer/lib/stores/update-store');

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
  useUpdateStore.setState({ state: { status: 'idle' } });
});

function render(node: React.ReactNode): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const client = new QueryClient();
  flushSync(() => root!.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>));
  return host;
}

const NOTE = /could not reach the chord sync server/i;
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

describe('sign-in and the sync server', () => {
  it('says so when the version check could not reach the sync server', async () => {
    verdict = { state: 'unknown', checked: true, reason: 'sync server unreachable: fetch failed' };
    const view = render(<AuthGate onAuthenticated={() => {}} />);
    await vi.waitFor(() => expect(view.textContent).toMatch(NOTE));
  });

  it('says nothing when the server answered', async () => {
    verdict = { state: 'supported', current: '1.0.0', minimum: '0.1.0' };
    const view = render(<AuthGate onAuthenticated={() => {}} />);
    await vi.waitFor(() => expect(view.textContent).toContain('Sign in'));
    await settle();
    expect(view.textContent).not.toMatch(NOTE);
  });
});

describe('Settings and a build with no updater', () => {
  it('says the build cannot update itself, not that it is up to date', async () => {
    useUpdateStore.setState({ state: { status: 'unavailable' } });
    const view = render(<UpdateCard />);
    await vi.waitFor(() => expect(view.textContent).toContain('cannot update itself'));
    expect(view.textContent).not.toMatch(/up to date/i);
  });

  // A re-check on such a build only repeats the same note: the card offers none.
  it('offers no Check for updates on a build that cannot update itself', async () => {
    const checkButton = (view: HTMLElement) =>
      view.querySelector('button[aria-label="Check for updates"]');
    useUpdateStore.setState({ state: { status: 'idle' } });
    const idle = render(<UpdateCard />);
    await vi.waitFor(() => expect(checkButton(idle)).not.toBeNull());
    root?.unmount();
    host?.remove();

    useUpdateStore.setState({ state: { status: 'unavailable' } });
    const view = render(<UpdateCard />);
    await vi.waitFor(() => expect(view.textContent).toContain('cannot update itself'));
    expect(checkButton(view)).toBeNull();
  });

  // The boot check is the only word an inactive updater gives (it sends no event).
  // Dropping its answer left the card idle, and idle reads "You're up to date."
  it('says so from launch, before anyone checks', async () => {
    bootCheck = { success: true, result: null, active: false };
    useUpdateStore.getState().start();
    const view = render(<UpdateCard />);
    await vi.waitFor(() => expect(view.textContent).toContain('cannot update itself'));
    expect(view.textContent).not.toMatch(/up to date/i);
  });

  it('leaves an active build that found nothing reading up to date', async () => {
    bootCheck = { success: true, result: null, active: true };
    useUpdateStore.getState().start();
    const view = render(<UpdateCard />);
    await vi.waitFor(() => expect(view.textContent).toMatch(/up to date/i));
    await settle();
    expect(view.textContent).not.toContain('cannot update itself');
  });
});
