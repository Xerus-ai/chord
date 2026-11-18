import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * deploy.sh's real migrate step (devstation-mg6u.10, from devstation-5s42's
 * review) against a real Postgres: the before/after pending count that decides
 * whether a failed migrate logs schema_ahead. Only install/build
 * (DEPLOY_PREPARE) and the restart are stood in; migrate is the real
 * server/src/db/migrate.ts over the real migration set.
 *
 * Needs CHORD_DEPLOY_TEST_DATABASE_URL: the direct URL of a disposable database
 * (a Neon branch made for the run). Every case drops and recreates its public
 * schema. Run with: pnpm run test:deploy-db
 */
const DATABASE_URL = process.env.CHORD_DEPLOY_TEST_DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'CHORD_DEPLOY_TEST_DATABASE_URL is not set: point it at a disposable database (its public schema is dropped)'
  );
}

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..');
const SERVER = join(APP, 'server');
const DEPLOY_SH = join(SERVER, 'deploy', 'deploy.sh');
const TSX_CLI = join(APP, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const MIGRATE_TS = join(SERVER, 'src', 'db', 'migrate.ts');
const SHA = 'd'.repeat(40);
const slash = (p: string) => p.replace(/\\/g, '/');

function bashPath(): string {
  if (process.platform !== 'win32') return 'bash';
  const git = execFileSync('where', ['git'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
  for (let dir = dirname(git); dir !== dirname(dir); dir = dirname(dir)) {
    const bash = join(dir, 'bin', 'bash.exe');
    if (existsSync(bash)) return bash;
  }
  throw new Error(`no Git Bash next to ${git}`);
}
const BASH = bashPath();

/** Runs SQL on the test database with the driver migrate.ts uses. */
function sql(statement: string): void {
  execFileSync(
    'node',
    [
      '--input-type=module',
      '-e',
      `import { Client, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
neonConfig.webSocketConstructor = ws;
const c = new Client(process.env.U);
await c.connect();
await c.query(process.argv[1]);
await c.end();`,
      statement,
    ],
    { cwd: SERVER, env: { ...process.env, U: DATABASE_URL }, stdio: 'pipe' }
  );
}

function resetDatabase(extra = ''): void {
  sql(`DROP SCHEMA public CASCADE; CREATE SCHEMA public; ${extra}`);
}

const temps: string[] = [];
let pidFile = '';
afterAll(() => {
  if (pidFile && existsSync(pidFile)) {
    spawnSync(BASH, ['-c', `kill "$(cat '${slash(pidFile)}')" 2>/dev/null; true`]);
  }
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

/**
 * A release whose `pnpm run migrate` is the real migrate.ts, and whose server
 * answers /health with the tag deploy.sh wrote to release.env.
 */
function releaseTar(): Buffer {
  const dir = temp('deploy-db-release-');
  mkdirSync(join(dir, 'server'), { recursive: true });
  writeFileSync(
    join(dir, 'server', 'package.json'),
    JSON.stringify({
      name: 'deploy-db-release',
      private: true,
      scripts: { migrate: `node "${slash(TSX_CLI)}" "${slash(MIGRATE_TS)}"` },
    })
  );
  writeFileSync(
    join(dir, 'server', 'health.mjs'),
    `import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(process.env.RELEASE_ENV, 'utf8').split('\\n').filter(Boolean).map((l) => l.split('='))
);
createServer((_req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ status: 'ok', version: env.CHORD_RELEASE_TAG }));
}).listen(Number(process.env.PORT), '127.0.0.1');
`
  );
  return execFileSync('tar', ['-c', '-C', slash(dir), '.'], { maxBuffer: 1 << 24 });
}

describe('deploy.sh migrate on a real database', () => {
  it('the real migrate step reports what it applied', { timeout: 600_000 }, async () => {
    const root = slash(temp('deploy-db-root-'));
    const port = await freePort();
    pidFile = `${root}/server.pid`;
    mkdirSync(`${root}/shared`, { recursive: true });
    writeFileSync(`${root}/shared/.env`, `MIGRATE_DATABASE_URL=${DATABASE_URL}\n`);
    const restart =
      `if [ -f '${pidFile}' ]; then kill "$(cat '${pidFile}')" 2>/dev/null; sleep 0.5; fi; ` +
      `RELEASE_ENV='${root}/shared/release.env' PORT=${port} ` +
      `node '${root}/current/server/health.mjs' > '${root}/server.log' 2>&1 & echo $! > '${pidFile}'`;
    const deploy = (tag: string) => {
      const res = spawnSync(BASH, [DEPLOY_SH], {
        input: releaseTar(),
        encoding: 'utf8',
        timeout: 300_000,
        env: {
          ...process.env,
          MSYS: 'winsymlinks:nativestrict',
          SSH_ORIGINAL_COMMAND: `deploy ${tag} ${SHA}`,
          DEPLOY_ROOT: root,
          DEPLOY_PREPARE: 'true',
          DEPLOY_RESTART: restart,
          DEPLOY_HEALTH_URL: `http://127.0.0.1:${port}/health`,
          DEPLOY_HEALTH_INTERVAL: '0.2',
          // Never the developer's own pnpm store.
          DEPLOY_STORE_PRUNE: 'true',
        },
      });
      return { code: res.status, out: `${res.stdout}${res.stderr}` };
    };
    const schemaAhead = () =>
      (readFileSync(`${root}/shared/deploy.log`, 'utf8').match(/schema_ahead: true/g) ?? []).length;

    // A clean database: every migration applies and the release goes live.
    resetDatabase();
    const clean = deploy('v1.0.0');
    expect(clean.code, clean.out).toBe(0);
    expect(clean.out).toMatch(/deploy: live/);
    expect(schemaAhead()).toBe(0);

    // 0006 creates yjs_documents; a table already there fails it after 0000-0005
    // committed, so the database is ahead of the live release.
    resetDatabase('CREATE TABLE yjs_documents (x int);');
    const partly = deploy('v1.1.0');
    expect(partly.code, partly.out).toBe(1);
    expect(partly.out).toMatch(/migrate failed partway/);
    expect(schemaAhead()).toBe(1);

    // A users table with no ledger is refused before any file runs: nothing is
    // applied, so there is no schema_ahead.
    resetDatabase('CREATE TABLE users (x int);');
    const refused = deploy('v1.2.0');
    expect(refused.code, refused.out).toBe(1);
    expect(refused.out).toMatch(/migrate failed before applying anything/);
    expect(schemaAhead()).toBe(1);
  });

  // devstation-mg6u.9: a second runner used to wait on the advisory lock forever.
  it(
    'migrate refuses within the lock wait while another session holds the lock',
    { timeout: 300_000 },
    async () => {
      resetDatabase();
      const holder = spawn(
        'node',
        [
          '--input-type=module',
          '-e',
          `import { Client, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
neonConfig.webSocketConstructor = ws;
const c = new Client(process.env.U);
await c.connect();
const { rows } = await c.query('SELECT pg_advisory_lock(4919170251), pg_backend_pid() AS pid');
console.log('held ' + rows[0].pid);
process.stdin.on('data', async () => { await c.end(); process.exit(0); });`,
        ],
        {
          cwd: SERVER,
          env: { ...process.env, U: DATABASE_URL },
          stdio: ['pipe', 'pipe', 'inherit'],
        }
      );
      const holderPid = await new Promise<string>((resolve, reject) => {
        holder.stdout.on('data', (chunk: Buffer) => {
          const m = /held (\d+)/.exec(chunk.toString());
          if (m) resolve(m[1]);
        });
        holder.on('exit', (code) => reject(new Error(`lock holder exited ${code}`)));
      });
      const migrate = () =>
        spawnSync('node', [TSX_CLI, MIGRATE_TS, '--unreleased'], {
          cwd: temp('migrate-lock-'),
          encoding: 'utf8',
          timeout: 120_000,
          env: { ...process.env, DATABASE_URL, CHORD_MIGRATE_LOCK_WAIT_S: '3' },
        });

      try {
        const started = Date.now();
        const blocked = migrate();
        expect(blocked.status, blocked.stderr).not.toBe(0);
        expect(`${blocked.stdout}${blocked.stderr}`).toMatch(
          new RegExp(`lock.*held by pid ${holderPid}`)
        );
        expect(Date.now() - started).toBeLessThan(60_000);
      } finally {
        // Released even when an assertion above fails, so no later case waits on the lock.
        holder.stdin.write('release\n');
        await new Promise((resolve) => holder.on('exit', resolve));
      }
      const applied = migrate();
      expect(applied.status, `${applied.stdout}${applied.stderr}`).toBe(0);
      expect(applied.stdout).toMatch(/\[migrate\] done/);
    }
  );
});
