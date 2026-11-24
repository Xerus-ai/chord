import { describe, expect, it } from 'vitest';
import { PACKAGED_ENV_NAMES, readPackagedEnv } from './build-env.ts';

/**
 * The values a release build bakes into the packaged app (devstation-pqub, from czxn): a
 * packaged app has no .env, and its main process refuses to start without these. A release
 * build missing one, or pointing one at a non-TLS address such as a developer's localhost
 * server, must fail the build instead of shipping an app that cannot sign in.
 */
const PRODUCTION: Record<string, string> = Object.fromEntries(
  PACKAGED_ENV_NAMES.map((name) => [
    name,
    /_URL$|_URI$/.test(name)
      ? `${name.includes('WS') ? 'wss' : 'https'}://api.example.test/${name.toLowerCase()}`
      : `${name.toLowerCase()}-value`,
  ])
);

describe('readPackagedEnv', () => {
  it('bakes nothing outside a release build, whatever the shell holds', () => {
    expect(readPackagedEnv({ ...PRODUCTION })).toEqual({});
  });

  it('bakes every packaged-app variable in a release build', () => {
    const baked = readPackagedEnv({ ...PRODUCTION, CHORD_RELEASE_BUILD: '1', PATH: '/bin' });

    expect(baked).toEqual(PRODUCTION);
    expect(baked).not.toHaveProperty('PATH');
  });

  it('refuses a release build missing variables, naming each', () => {
    const env: Record<string, string | undefined> = { ...PRODUCTION, CHORD_RELEASE_BUILD: '1' };
    delete env.WORKOS_CLIENT_ID;
    env.CHORD_AUTH_SERVER_URL = '';

    expect(() => readPackagedEnv(env)).toThrow(
      /WORKOS_CLIENT_ID.*CHORD_AUTH_SERVER_URL|CHORD_AUTH_SERVER_URL.*WORKOS_CLIENT_ID/
    );
  });

  it("refuses a release build whose URL is not TLS (a developer's localhost server)", () => {
    const env = {
      ...PRODUCTION,
      CHORD_RELEASE_BUILD: '1',
      VITE_CLOUD_WS_URL: 'ws://localhost:1234/ws',
    };

    expect(() => readPackagedEnv(env)).toThrow(/VITE_CLOUD_WS_URL.*ws:\/\/localhost/);
  });

  it('covers the sign-in and cloud addresses the main process and renderer require', () => {
    for (const name of [
      'WORKOS_CLIENT_ID',
      'WORKOS_REDIRECT_URI',
      'WORKOS_AUTHKIT_URL',
      'CHORD_AUTH_SERVER_URL',
      'CHORD_CLOUD_API_URL',
      'VITE_CLOUD_API_URL',
      'VITE_CLOUD_WS_URL',
      'VITE_COLLAB_WS_URL',
    ]) {
      expect(PACKAGED_ENV_NAMES).toContain(name);
    }
  });
});
