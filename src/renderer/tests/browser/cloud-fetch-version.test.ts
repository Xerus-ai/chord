/**
 * The renderer names its version on every request to the sync server
 * (devstation-mg6u.13): the server refuses a request without it. Real Chromium,
 * cross-origin, against the local API stand-in the browser project starts
 * (cloud-api-stand-in.setup.ts), so the header also has to survive the CORS
 * preflight. The bug this catches: the renderer's API helper forgetting the
 * header, which locks the signed-in app out of its own server.
 *
 * Only the preload bridge is supplied: invoke answers the access token.
 */
import { SemverSchema } from '@chord/protocol';
import { describe, expect, it } from 'vitest';
import packageJson from '../../../../package.json';

Object.assign(window, {
  electronAPI: {
    invoke: async (channel: string) => {
      if (channel === 'account.getAccessToken') return 'test-token';
      throw new Error(`the test asked the main process for ${channel}`);
    },
    eventOn: () => () => {},
    eventSend: () => {},
    getPathForFile: () => '',
  },
});

const { cloudFetch } = await import('@renderer/lib/cloud-fetch');

type Seen = { method: string; path: string; version: string | null };

describe('the renderer names its version to the sync server', () => {
  it('sends X-Chord-Version with the app version on cloudFetch, through the CORS preflight', async () => {
    expect(SemverSchema.safeParse(packageJson.version).success).toBe(true);
    await cloudFetch('/work-items/version-probe');
    const seen = (await (
      await fetch(`${import.meta.env.VITE_CLOUD_API_URL}/__seen`)
    ).json()) as Seen[];
    const probe = seen.find((s) => s.path === '/work-items/version-probe');
    expect(probe).toBeDefined();
    expect(probe!.version).toBe(packageJson.version);
  });
});
