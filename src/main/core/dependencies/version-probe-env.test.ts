import { describe, expect, it } from 'vitest';
import { getProvider } from '@shared/agent-providers';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { updatableAgentFromProvider } from './agent-updater';
import { runVersionProbe } from './probe';
import { getDependencyDescriptor } from './registry';

/**
 * A version probe must not change the agent it reads (devstation-nj4).
 * `droid --version` downloads and installs a Droid update before printing,
 * so the probe timed out (no version shown) and self-updated the user's Droid
 * on every probe. Droid reads `FACTORY_DROID_AUTO_UPDATE_ENABLED` before its
 * settings file ("false" turns the updater off; measured on droid 0.233.0:
 * the version in 0.2 s, binary untouched).
 */
describe('version probe environment', () => {
  it('reaches the probed process', async () => {
    const probe = await runVersionProbe(
      'node',
      null,
      ['-e', 'console.log(process.env.CHORD_PROBE_ENV_CHECK)'],
      new LocalExecutionContext(),
      { env: { CHORD_PROBE_ENV_CHECK: '4.5.6' } }
    );

    expect(probe.exitCode).toBe(0);
    expect(probe.stdout.trim()).toBe('4.5.6');
  });

  it("turns Droid's self-updater off for the settings probe and the update check", () => {
    const off = { FACTORY_DROID_AUTO_UPDATE_ENABLED: 'false' };

    expect(getDependencyDescriptor('droid')?.versionProbeEnv).toEqual(off);
    const droid = getProvider('droid');
    if (!droid) throw new Error('droid is not in the provider registry');
    expect(updatableAgentFromProvider(droid).versionProbeEnv).toEqual(off);
  });
});
