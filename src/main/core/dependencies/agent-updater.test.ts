import { execSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import {
  createNpmPrefix,
  npmInstallGlobal,
  npmViewVersion,
  removeNpmPrefix,
  useNpmPrefix,
} from './_testing/npm-prefix-fixture';
import { checkAgentUpdate, runAgentUpdate, type UpdatableAgent } from './agent-updater';
import { runLocalInstallCommand } from './install-runner';

/**
 * An agent CLI that is behind its latest release can be seen and updated from
 * Chord, outside any lane (devstation-ext): the check reads the installed and
 * latest versions, and the update runs the agent's update command through the
 * install runner, then reads the version again.
 *
 * End to end with the real npm, registry and a real PTY: each test installs an
 * old `marked` (no dependencies; `marked --version` prints its version) into
 * its own temporary npm global prefix that npm and PATH point at, and drives
 * it as an npm-installed agent. Nothing touches the machine's own installs.
 */
const OLD = '12.0.0';
const NPM_TIMEOUT_MS = 180_000;

const marked: UpdatableAgent = {
  id: 'opencode',
  npmPackage: 'marked',
  commands: ['marked'],
  versionArgs: ['--version'],
};

let prefix: string;
let restoreEnv: () => void;

beforeEach(() => {
  prefix = createNpmPrefix();
  npmInstallGlobal(prefix, `marked@${OLD}`);
  restoreEnv = useNpmPrefix(prefix);
}, NPM_TIMEOUT_MS);

afterEach(() => {
  restoreEnv?.();
  if (prefix) removeNpmPrefix(prefix);
});

function installedMarkedVersion(): string {
  return execSync('marked --version', { encoding: 'utf-8' }).trim();
}

describe('checkAgentUpdate', () => {
  it('reports an npm agent behind the registry’s latest, and where latest came from', async () => {
    const latest = npmViewVersion('marked');

    const check = await checkAgentUpdate(marked, new LocalExecutionContext());

    expect(check).toMatchObject({
      id: 'opencode',
      installedVersion: OLD,
      latestVersion: latest,
      updateAvailable: true,
      source: { kind: 'npm', package: 'marked' },
    });
    expect(check?.checkedAt).toBeGreaterThan(Date.now() - 60_000);
  });

  it('offers nothing for an agent with no update command', async () => {
    const check = await checkAgentUpdate(
      { ...marked, npmPackage: undefined },
      new LocalExecutionContext()
    );

    expect(check).toBeNull();
  });
});

describe('runAgentUpdate', () => {
  it(
    'updates the agent and reports the version it now runs, with the command output',
    async () => {
      const latest = npmViewVersion('marked');
      const ctx = new LocalExecutionContext();

      const result = await runAgentUpdate(marked, ctx, runLocalInstallCommand);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.version).toBe(latest);
      expect(result.data.output).toMatch(/marked|package/i);
      expect(installedMarkedVersion()).toBe(latest);
      expect(await checkAgentUpdate(marked, ctx)).toMatchObject({
        installedVersion: latest,
        updateAvailable: false,
      });
    },
    NPM_TIMEOUT_MS
  );

  it(
    'reports a failed update command with its output, leaving the agent as it was',
    async () => {
      const saved = {
        registry: process.env.npm_config_registry,
        retries: process.env.npm_config_fetch_retries,
      };
      process.env.npm_config_registry = 'http://127.0.0.1:9/';
      process.env.npm_config_fetch_retries = '0';
      try {
        const result = await runAgentUpdate(
          marked,
          new LocalExecutionContext(),
          runLocalInstallCommand
        );

        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error.type).toBe('command-failed');
        expect(result.error).toHaveProperty(
          'output',
          expect.stringMatching(/ECONNREFUSED|127\.0\.0\.1/)
        );
        expect(installedMarkedVersion()).toBe(OLD);
      } finally {
        if (saved.registry === undefined) delete process.env.npm_config_registry;
        else process.env.npm_config_registry = saved.registry;
        if (saved.retries === undefined) delete process.env.npm_config_fetch_retries;
        else process.env.npm_config_fetch_retries = saved.retries;
      }
    },
    NPM_TIMEOUT_MS
  );

  it(
    'reports an update that left the version unchanged as an error',
    async () => {
      const latest = npmViewVersion('marked');
      npmInstallGlobal(prefix, `marked@${latest}`);

      const result = await runAgentUpdate(
        marked,
        new LocalExecutionContext(),
        runLocalInstallCommand
      );

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toMatchObject({
        type: 'version-unchanged',
        id: 'opencode',
        version: latest,
      });
      expect(result.error).toHaveProperty('output', expect.any(String));
    },
    NPM_TIMEOUT_MS
  );

  it('refuses an agent with no update command, running nothing', async () => {
    const result = await runAgentUpdate(
      { ...marked, npmPackage: undefined },
      new LocalExecutionContext(),
      runLocalInstallCommand
    );

    expect(result).toEqual({ success: false, error: { type: 'no-update-spec', id: 'opencode' } });
    expect(installedMarkedVersion()).toBe(OLD);
  });
});
