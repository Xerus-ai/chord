import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The migrate CLI writes to the database only when a release deploy runs it
 * (CHORD_RELEASE_TAG, set by deploy.sh) or the caller says `--unreleased`. Dev
 * and prod share one database, so a plain `pnpm run migrate` from a feature
 * branch would otherwise put unreleased files in production.
 *
 * Runs the real CLI with DATABASE_URL on a host under the reserved `.invalid`
 * domain: an allowed run tries to connect and fails resolving that host (the
 * Neon driver dials wss://<host>/v2, ignoring the URL's port, so a local
 * listener would never see it); a refused run must exit before any lookup. The
 * cwd is an empty directory so no .env is loaded into the run.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', '..');
const TSX_CLI = join(APP, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const MIGRATE_TS = join(HERE, 'migrate.ts');
const REFUSAL = /refusing to write/;

const HOST = 'migrate-guard.invalid';
// ENOTFOUND where the resolver answers, EAI_AGAIN where a CI container has none.
const CONNECT_ATTEMPT = /(ENOTFOUND|EAI_AGAIN) migrate-guard\.invalid/;
// Each case starts tsx and compiles migrate.ts; a loaded full run is slow.
const CASE_TIMEOUT_MS = 60_000;

let cwd = '';

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'migrate-guard-'));
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

interface Run {
  code: number | null;
  output: string;
  connected: boolean;
}

function runMigrate(
  args: string[],
  extraEnv: Record<string, string> = {},
  dir = cwd
): Promise<Run> {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
  if (!('CHORD_RELEASE_TAG' in extraEnv)) delete env.CHORD_RELEASE_TAG;
  env.DATABASE_URL = `postgres://${HOST}/guard`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TSX_CLI, MIGRATE_TS, ...args], { cwd: dir, env });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    const timer = setTimeout(() => child.kill(), CASE_TIMEOUT_MS - 5_000);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output, connected: CONNECT_ATTEMPT.test(output) });
    });
  });
}

describe('migrate CLI write guard', { timeout: CASE_TIMEOUT_MS }, () => {
  it('refuses to apply without a release tag or --unreleased, before connecting', async () => {
    const run = await runMigrate([]);
    expect(run.code).not.toBe(0);
    expect(run.output).toMatch(REFUSAL);
    expect(run.output).toMatch(/--unreleased/);
    expect(run.connected).toBe(false);
  });

  it('refuses --baseline the same way', async () => {
    const run = await runMigrate(['--baseline', '0010']);
    expect(run.code).not.toBe(0);
    expect(run.output).toMatch(REFUSAL);
    expect(run.connected).toBe(false);
  });

  it('refuses a release tag that is only whitespace', async () => {
    const run = await runMigrate([], { CHORD_RELEASE_TAG: '   ' });
    expect(run.output).toMatch(REFUSAL);
    expect(run.connected).toBe(false);
  });

  it('refuses a release tag that comes from a .env file instead of the deploy', async () => {
    const withEnvFile = mkdtempSync(join(tmpdir(), 'migrate-guard-env-'));
    try {
      writeFileSync(join(withEnvFile, '.env'), 'CHORD_RELEASE_TAG=v9.9.9\n');
      const run = await runMigrate([], {}, withEnvFile);
      expect(run.output).toMatch(REFUSAL);
      expect(run.connected).toBe(false);
    } finally {
      rmSync(withEnvFile, { recursive: true, force: true });
    }
  });

  it.each([
    ['--status', ['--status'], {}],
    ['a release tag', [], { CHORD_RELEASE_TAG: 'v9.9.9' }],
    ['--unreleased', ['--unreleased'], {}],
  ] as const)('lets %s through to the database', async (_label, args, extraEnv) => {
    const run = await runMigrate([...args], { ...extraEnv });
    expect(run.output).not.toMatch(REFUSAL);
    expect(run.connected).toBe(true);
    // The host never resolves, so the run still fails, later.
    expect(run.code).not.toBe(0);
  });
});
