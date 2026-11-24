/**
 * The "could not reach the sync server" note on sign-in, in real Chromium. The bug
 * this catches: with the server down the note painted alone on a blank page, about
 * two seconds before the wordmark and the sign-in content faded in. It belongs with
 * the Sign in button, so it enters when the button does.
 *
 * Only the preload bridge is supplied: invoke answers the version verdict and the
 * public URLs the sign-in screen reads.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { DesktopCompatibility } from '@shared/desktop-compatibility';
import '@renderer/index.css';

const unreachable: DesktopCompatibility = {
  state: 'unknown',
  checked: true,
  reason: 'sync server unreachable: fetch failed',
};

Object.assign(window, {
  electronAPI: {
    invoke: async (channel: string) => {
      if (channel === 'app.getDesktopCompatibility') return unreachable;
      if (channel === 'app.getPublicUrls') return { terms: null, privacy: null };
      throw new Error(`the screen asked the main process for ${channel}`);
    },
    eventOn: () => () => {},
    eventSend: () => {},
    getPathForFile: () => '',
  },
});

const { AuthGate } = await import('@renderer/features/auth/auth-gate');

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
});

function render(node: React.ReactNode): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const client = new QueryClient();
  flushSync(() => root!.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>));
  return host;
}

const opacity = (el: Element) => Number(getComputedStyle(el).opacity);

it('the note stays hidden while the page boots and shows once Sign in does', async () => {
  const view = render(<AuthGate onAuthenticated={() => {}} />);
  const note = await vi.waitFor(() => {
    const found = [...view.querySelectorAll('[role="status"]')].find((el) =>
      /could not reach the chord sync server/i.test(el.textContent ?? '')
    );
    expect(found).toBeDefined();
    return found!;
  });
  const signIn = [...view.querySelectorAll('button')].find((b) => b.textContent === 'Sign in')!;

  // the verdict is in long before the boot sequence ends: the button is still hidden
  expect((signIn as HTMLButtonElement).disabled).toBe(true);
  expect(opacity(note)).toBe(0);

  // once Sign in is pressable, the note has entered with it
  await vi.waitFor(() => expect((signIn as HTMLButtonElement).disabled).toBe(false), {
    timeout: 5000,
  });
  await vi.waitFor(() => expect(opacity(note)).toBe(1), { timeout: 2000 });
});
