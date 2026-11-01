import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import {
  createNpmPrefix,
  npmInstallGlobal,
  removeNpmPrefix,
  useNpmPrefix,
} from './_testing/npm-prefix-fixture';
import { resolveCommandPath, runVersionProbe } from './probe';

/**
 * The installed version of an npm-installed CLI is readable (devstation-ext:
 * an update check compares it with the registry's latest).
 *
 * On Windows npm installs a CLI as launchers in the prefix — an extensionless
 * shell script, `.cmd` and `.ps1`. `where` lists the extensionless one first,
 * and neither it nor the `.cmd` can be started directly (`execFile` gives
 * ENOENT / EINVAL), so the probe read no version for any npm agent
 * (`C:\Program Files\nodejs\opencode` → ENOENT, measured 2026-10-04).
 *
 * A real `marked@12.0.0` (no dependencies; `marked --version` prints `12.0.0`)
 * is installed with the real npm into a temporary global prefix on PATH.
 */
const INSTALLED = '12.0.0';

let prefix: string;
let restoreEnv: () => void;

beforeAll(() => {
  prefix = createNpmPrefix();
  npmInstallGlobal(prefix, `marked@${INSTALLED}`);
  restoreEnv = useNpmPrefix(prefix);
}, 120_000);

afterAll(() => {
  restoreEnv?.();
  if (prefix) removeNpmPrefix(prefix);
});

describe('version probe — npm-installed CLI', () => {
  it('resolves the CLI inside the npm prefix', async () => {
    const path = await resolveCommandPath('marked', new LocalExecutionContext());

    expect(path?.toLowerCase().startsWith(prefix.toLowerCase())).toBe(true);
  });

  it('runs the resolved CLI and reads its version', async () => {
    const ctx = new LocalExecutionContext();
    const path = await resolveCommandPath('marked', ctx);

    const probe = await runVersionProbe('marked', path, ['--version'], ctx);

    expect(probe.exitCode).toBe(0);
    expect(probe.stdout.trim()).toBe(INSTALLED);
  });
});
