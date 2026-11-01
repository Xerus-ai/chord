import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

/**
 * A real, throwaway npm global prefix for tests: packages are installed into it
 * by the real npm, and `useNpmPrefix` points npm (`npm_config_prefix`) and PATH
 * at it, so `npm prefix -g`, `where`/`which` and `npm install -g` in the code
 * under test all see this prefix instead of the machine's own. Each prefix has
 * its own npm cache inside it, so suites running in parallel share no npm state.
 */

const NPM_TIMEOUT_MS = 120_000;

/**
 * 0xC0000409 (STATUS_STACK_BUFFER_OVERRUN): a Windows fast-fail abort of npm's
 * node.exe that prints nothing. Seen once, 1 of 75 installs inside the full
 * verify (node v24.15.0, npm 11.12.1; 2026-10-04): exit status 3221226505,
 * empty stdout and stderr. Not reproduced in isolation: 0 of 450 installs in
 * six parallel vitest workers, 0 of 450 in six parallel node processes
 * (2026-10-07, devstation-fyw). It goes with the full suite's load, not with
 * vitest.
 */
const NPM_FAST_FAIL_STATUS = 3221226505;

function runNpm(args: string, cwd: string | undefined): string {
  return execSync(`npm ${args}`, {
    cwd,
    encoding: 'utf-8',
    timeout: NPM_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Runs npm, retrying once only when npm itself crashed with the fast-fail
 * above. Any other failure, or a second crash, throws at once.
 */
function npm(args: string, cwd?: string): string {
  try {
    return runNpm(args, cwd);
  } catch (error) {
    if ((error as { status?: number }).status !== NPM_FAST_FAIL_STATUS) throw error;
    console.warn(
      `npm ${args} crashed with status ${NPM_FAST_FAIL_STATUS} (0xC0000409, ` +
        'STATUS_STACK_BUFFER_OVERRUN); retrying once'
    );
    return runNpm(args, cwd);
  }
}

export function createNpmPrefix(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'chord-npm-prefix-')));
}

export function removeNpmPrefix(prefix: string): void {
  rmSync(prefix, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

/** Where npm puts a global package's launchers for this prefix. */
export function npmBinDir(prefix: string): string {
  return process.platform === 'win32' ? prefix : join(prefix, 'bin');
}

function npmCacheDir(prefix: string): string {
  return join(prefix, '.npm-cache');
}

/** `npm install -g <spec>` into `prefix`, with the real npm and registry. */
export function npmInstallGlobal(prefix: string, spec: string): void {
  npm(
    `install -g --prefix "${prefix}" --cache "${npmCacheDir(prefix)}" ${spec} --no-fund --no-audit`
  );
}

/** The registry's current `latest` for a package, read with the real npm CLI. */
export function npmViewVersion(pkg: string): string {
  return npm(`view ${pkg} version`);
}

/**
 * Packs a package whose name and bin are given into a tarball in `dir`, so it
 * can be installed with the real `npm install -g` like a published one. Its bin
 * prints `<versionLine>`.
 */
export function packFixturePackage(
  dir: string,
  {
    name,
    version,
    bin,
    versionLine,
  }: { name: string; version: string; bin: string; versionLine: string }
): string {
  const pkgDir = join(dir, 'fixture-package');
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, 'package.json'),
    JSON.stringify({ name, version, bin: { [bin]: 'cli.js' } }, null, 2)
  );
  writeFileSync(
    join(pkgDir, 'cli.js'),
    `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(`${versionLine}\n`)});\n`
  );
  const tarball = npm(`pack --pack-destination "${dir}"`, pkgDir).split('\n').pop();
  if (!tarball) throw new Error(`npm pack produced no tarball for ${name}`);
  return join(dir, tarball);
}

/**
 * Points npm (prefix and cache) and PATH at `prefix` for the code under test.
 * Returns the restore function; call it in `afterEach`/`afterAll`.
 */
export function useNpmPrefix(prefix: string): () => void {
  const saved = {
    prefix: process.env.npm_config_prefix,
    cache: process.env.npm_config_cache,
    path: process.env.PATH,
  };
  process.env.npm_config_prefix = prefix;
  process.env.npm_config_cache = npmCacheDir(prefix);
  process.env.PATH = `${npmBinDir(prefix)}${delimiter}${process.env.PATH ?? ''}`;
  return () => {
    restoreEnv('npm_config_prefix', saved.prefix);
    restoreEnv('npm_config_cache', saved.cache);
    process.env.PATH = saved.path;
  };
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
