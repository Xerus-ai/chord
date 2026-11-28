/**
 * The renderer's feature flags follow main's changes even while nothing that reads them is on
 * screen (devstation-mg6u.98), in real Chromium. The bug this catches: the change listener lived
 * in the hook, so it ran only while a reader was mounted; flags are cached for good
 * (staleTime Infinity), so Settings reopened after a change showed the old flags.
 *
 * Only the preload bridge is supplied: invoke answers app.getFeatureFlags once with the flag off,
 * and eventOn keeps each listener so the test can send main's change.
 */
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import '@renderer/index.css';
import { mount, unmountAll } from './mount';

const listeners = new Map<string, Set<(data: unknown) => void>>();
let reads = 0;

Object.assign(window, {
  electronAPI: {
    invoke: async (channel: string) => {
      if (channel === 'app.getFeatureFlags') {
        reads += 1;
        return { whats_new: false };
      }
      throw new Error(`the card asked the main process for ${channel}`);
    },
    eventOn: (channel: string, cb: (data: unknown) => void) => {
      const set = listeners.get(channel) ?? new Set();
      set.add(cb);
      listeners.set(channel, set);
      return () => set.delete(cb);
    },
    eventSend: () => {},
    getPathForFile: () => '',
  },
});

const { subscribeFeatureFlags } = await import('@renderer/lib/feature-flags/use-feature-flag');
const { PreviewFeaturesCard } = await import(
  '@renderer/features/settings/components/PreviewFeaturesCard'
);

afterEach(() => unmountAll());

const state = (host: HTMLElement) =>
  host.querySelector<HTMLElement>('[data-testid="feature-flag-whats_new"]')?.dataset.state;

describe('feature flags listener', () => {
  it('a change while no reader is mounted shows on the next mount', async () => {
    const client = new QueryClient();
    subscribeFeatureFlags(client);

    const first = mount(<PreviewFeaturesCard />, client);
    await expect.poll(() => state(first)).toBe('off');
    unmountAll();

    // Main reports the server turned the flag on while Settings is closed.
    for (const cb of listeners.get('app:feature-flags') ?? []) cb({ whats_new: true });

    const again = mount(<PreviewFeaturesCard />, client);
    await expect.poll(() => state(again)).toBe('on');
    expect(reads).toBe(1);
  });
});
