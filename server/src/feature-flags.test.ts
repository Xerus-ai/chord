import { FEATURE_FLAGS, resolveFeatureFlags } from '@chord/protocol';
import { describe, expect, it, vi } from 'vitest';
import { enabledFeatureFlags } from './feature-flags';

// The app is imported once, before any test (as health.test.ts does): importing it inside a test
// ran past the 5 s test timeout under the full run. No database for this app.
vi.stubEnv('DATABASE_URL', '');
vi.stubEnv('DEV_MODE', '');
vi.stubEnv('WORKOS_CLIENT_ID', 'client_flags_test');
const { createApp } = await import('./server');
const { ConnectionManager } = await import('./ws/connection-manager');

/**
 * Feature flags (devstation-mg6u.90): the server names which registered flags are on, from the
 * optional CHORD_FEATURE_FLAGS. The bugs these catch: a typo on the box that silently turns
 * nothing on (it must stop the server, naming the name), a flag the app does not know that turns
 * something on, and a missing answer read as on.
 */
const REGISTERED = Object.keys(FEATURE_FLAGS).sort();

describe('resolveFeatureFlags', () => {
  it('names every registered flag; only true turns one on; unknown and missing names are off', () => {
    const none = resolveFeatureFlags(undefined);
    expect(Object.keys(none).sort()).toEqual(REGISTERED);
    expect(Object.values(none).every((on) => on === false)).toBe(true);

    const served = resolveFeatureFlags({ whats_new: true, not_a_flag: true });
    expect(Object.keys(served).sort()).toEqual(REGISTERED);
    expect(served.whats_new).toBe(true);

    expect(resolveFeatureFlags({ whats_new: false }).whats_new).toBe(false);
    expect(resolveFeatureFlags({}).whats_new).toBe(false);
  });
});

describe('enabledFeatureFlags', () => {
  it('turns on exactly the names listed; unset or empty turns none on', () => {
    expect(enabledFeatureFlags(' whats_new , ')).toEqual(
      Object.fromEntries(REGISTERED.map((name) => [name, name === 'whats_new']))
    );
    for (const raw of [undefined, '', ' , ']) {
      expect(Object.values(enabledFeatureFlags(raw)).every((on) => on === false)).toBe(true);
    }
  });

  it('refuses a name that is not a registered flag, naming it', () => {
    expect(() => enabledFeatureFlags('whats_new,whats_neww')).toThrow(/whats_neww/);
  });

  it('the server does not start with an unknown flag in CHORD_FEATURE_FLAGS', () => {
    vi.stubEnv('CHORD_FEATURE_FLAGS', 'whats_neww');
    try {
      expect(() => createApp(new ConnectionManager())).toThrow(/CHORD_FEATURE_FLAGS.*whats_neww/);
    } finally {
      vi.stubEnv('CHORD_FEATURE_FLAGS', '');
    }
  });
});
