/**
 * The renderer half of the version handshake (devstation-mg6u.2, .5), in real
 * Chromium. The gate in front of the app reads main's verdict over RPC and
 * then follows main's change events. The bugs these catch: the workspace (or
 * the sign-in wordmark) painted before the first verdict and then swapped
 * for the update screen; a placeholder that never leaves when the first
 * reading is unknown (server down); and an update screen whose buttons do not
 * reach the updater or the download page.
 *
 * Only the preload bridge is supplied: invoke answers the verdict and records
 * the updater calls; eventOn hands the test main's change channel.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { DesktopCompatibility } from '@shared/desktop-compatibility';
import '@renderer/index.css';

let verdict: DesktopCompatibility = { state: 'unknown', checked: false, reason: 'not checked yet' };
const calls: string[] = [];
const listeners = new Map<string, (data: unknown) => void>();

Object.assign(window, {
  electronAPI: {
    invoke: async (channel: string) => {
      calls.push(channel);
      if (channel === 'app.getDesktopCompatibility') return verdict;
      // The updater is busy for as long as the test looks.
      if (channel === 'update.check') return new Promise(() => {});
      if (channel === 'update.openLatest') return undefined;
      throw new Error(`the gate asked the main process for ${channel}`);
    },
    eventOn: (channel: string, cb: (data: unknown) => void) => {
      listeners.set(channel, cb);
      return () => listeners.delete(channel);
    },
    eventSend: () => {},
    getPathForFile: () => '',
  },
});

document.documentElement.classList.add('chord-dark');

const { DesktopCompatibilityGate } = await import(
  '@renderer/features/update-required/desktop-compatibility-gate'
);

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
  calls.length = 0;
  listeners.clear();
});

function renderGate(): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const client = new QueryClient();
  flushSync(() =>
    root!.render(
      <QueryClientProvider client={client}>
        <DesktopCompatibilityGate>
          <p>the workspace</p>
        </DesktopCompatibilityGate>
      </QueryClientProvider>
    )
  );
  return host;
}

function emit(state: DesktopCompatibility): void {
  const listener = listeners.get('app:desktop-compatibility');
  if (!listener) throw new Error('the gate does not listen for verdict changes');
  flushSync(() => listener(state));
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('the update-required gate', () => {
  it('shows neither the app nor the update screen until the first reading', async () => {
    verdict = { state: 'unknown', checked: false, reason: 'not checked yet' };
    const view = renderGate();
    await settle();
    expect(view.textContent).not.toContain('the workspace');
    expect(view.textContent).not.toContain('Update required');
    expect(calls).toContain('app.getDesktopCompatibility');
  });

  it('a first reading of unknown (server down) lets the app through', async () => {
    verdict = { state: 'unknown', checked: false, reason: 'not checked yet' };
    const view = renderGate();
    await settle();
    emit({ state: 'unknown', checked: true, reason: 'sync server unreachable: fetch failed' });
    await vi.waitFor(() => expect(view.textContent).toContain('the workspace'));
  });

  it('a supported verdict lets the app through; a later update_required replaces it', async () => {
    verdict = { state: 'supported', current: '1.0.0', minimum: '0.1.0' };
    const view = renderGate();
    await vi.waitFor(() => expect(view.textContent).toContain('the workspace'));
    emit({ state: 'update_required', current: '1.0.0', minimum: '2.0.0' });
    await vi.waitFor(() => expect(view.textContent).toContain('Update required'));
    expect(view.textContent).not.toContain('the workspace');
    expect(view.textContent).toContain('2.0.0');
  });

  it("the update screen's buttons drive the updater and the download page", async () => {
    verdict = { state: 'update_required', current: '1.0.0', minimum: '2.0.0' };
    const view = renderGate();
    const check = await vi.waitFor(() => {
      const found = [...view.querySelectorAll('button')].find((b) =>
        /check for updates/i.test(b.textContent ?? '')
      );
      if (!found) throw new Error('no Check for updates button');
      return found;
    });
    await userEvent.click(check);
    await vi.waitFor(() => expect(view.textContent).toContain('Checking…'));
    expect(calls).toContain('update.check');

    const website = [...view.querySelectorAll('button')].find((b) =>
      /download from the website/i.test(b.textContent ?? '')
    );
    if (!website) throw new Error('no Download from the website button');
    await userEvent.click(website);
    await vi.waitFor(() => expect(calls).toContain('update.openLatest'));
  });
});
