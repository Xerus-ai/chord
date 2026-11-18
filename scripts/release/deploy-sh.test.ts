import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * server/deploy/deploy.sh (design C5, devstation-5s42), run by real bash with a
 * real tar on stdin. The box's forced command hands it SSH_ORIGINAL_COMMAND, so
 * the request is untrusted input; the release it installs is started as a real
 * node process whose /health says which release it is. DEPLOY_* point the
 * script at a temp root, a restart command and a health URL in place of
 * /opt/chord, systemd and port 1234; the logic under test (parse, flip, flip
 * back, prune) is the script's own.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DEPLOY_SH = join(HERE, '..', '..', 'server', 'deploy', 'deploy.sh');
const SHA = 'c'.repeat(40);

/** Git Bash on Windows (a bare bash.exe on PATH is usually WSL's); bash elsewhere. */
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

const temps: string[] = [];
const pidFiles: string[] = [];
afterEach(() => {
  for (const pidFile of pidFiles.splice(0)) {
    if (!existsSync(pidFile)) continue;
    spawnSync(BASH, ['-c', `kill "$(cat '${pidFile.replace(/\\/g, '/')}')" 2>/dev/null; true`]);
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
 * A release tarball whose server answers /health with the tag deploy.sh wrote
 * to shared/release.env, or with `reports` when given (a release that is not
 * the one it claims to be, so its health check fails).
 */
function releaseTar(reports?: string): Buffer {
  const dir = temp('deploy-release-');
  mkdirSync(join(dir, 'server'), { recursive: true });
  writeFileSync(
    join(dir, 'server', 'health.mjs'),
    `import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(process.env.RELEASE_ENV, 'utf8').split('\\n').filter(Boolean).map((l) => l.split('='))
);
const version = ${reports ? JSON.stringify(reports) : 'env.CHORD_RELEASE_TAG'};
createServer((_req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ status: 'ok', version, commit: env.CHORD_RELEASE_COMMIT }));
}).listen(Number(process.env.PORT), '127.0.0.1');
`
  );
  return execFileSync('tar', ['-c', '-C', dir.replace(/\\/g, '/'), '.'], { maxBuffer: 1 << 24 });
}

interface Box {
  root: string;
  run: (
    request: string,
    tar?: Buffer,
    extra?: Record<string, string>
  ) => { code: number | null; out: string };
}

/** An empty deploy root plus a runner for deploy.sh against it. */
async function box(): Promise<Box> {
  const root = temp('deploy-root-');
  const port = await freePort();
  const r = root.replace(/\\/g, '/');
  const pidFile = `${r}/server.pid`;
  pidFiles.push(pidFile);
  // The stand-in for `systemctl restart chord-sync`: stop the running release,
  // start the one `current` points at.
  const restart =
    `if [ -f '${pidFile}' ]; then kill "$(cat '${pidFile}')" 2>/dev/null; sleep 0.5; fi; ` +
    `RELEASE_ENV='${r}/shared/release.env' PORT=${port} ` +
    `node '${r}/current/server/health.mjs' > '${r}/server.log' 2>&1 & echo $! > '${pidFile}'`;
  const run: Box['run'] = (request, tar, extra = {}) => {
    const res = spawnSync(BASH, [DEPLOY_SH], {
      input: tar ?? Buffer.alloc(0),
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        ...process.env,
        MSYS: 'winsymlinks:nativestrict',
        SSH_ORIGINAL_COMMAND: request,
        DEPLOY_ROOT: r,
        DEPLOY_PREPARE: 'true',
        DEPLOY_MIGRATE: 'true',
        DEPLOY_RESTART: restart,
        DEPLOY_HEALTH_URL: `http://127.0.0.1:${port}/health`,
        DEPLOY_HEALTH_INTERVAL: '0.2',
        ...extra,
      },
    });
    return { code: res.status, out: `${res.stdout}${res.stderr}` };
  };
  return { root, run };
}

function current(root: string): string {
  return basename(readlinkSync(join(root, 'current')).replace(/[\\/]+$/, ''));
}

describe('deploy.sh', () => {
  it('refuses every request that is not deploy <tag> <sha>', async () => {
    const { root, run } = await box();
    const refused = [
      '',
      'bash',
      'bash -i',
      `deploy 1.0.0 ${SHA}`,
      `deploy v1.0.0;id ${SHA}`,
      `deploy v1.0.0 ${SHA};id`,
      `deploy $(id) ${SHA}`,
      `deploy ../../etc ${SHA}`,
      'deploy v1.0.0 abc123',
      `deploy v1.0.0 ${SHA} extra`,
      `deploy  v1.0.0 ${SHA}`,
    ];
    for (const request of refused) {
      const res = run(request, releaseTar());
      expect(res.code, `request ${JSON.stringify(request)}: ${res.out}`).toBe(2);
    }
    // Refused before anything on the box changed.
    expect(readdirSync(root)).toEqual([]);
  });

  it('a failed health check flips back to the live release', { timeout: 120_000 }, async () => {
    const { root, run } = await box();
    const releases = join(root, 'releases');
    // The operator's .env (server/DEPLOYMENT.md); deploy.sh refuses to run without it.
    mkdirSync(join(root, 'shared'), { recursive: true });
    writeFileSync(join(root, 'shared', '.env'), 'MIGRATE_DATABASE_URL=postgres://unused\n');

    const first = run(`deploy v1.0.0 ${SHA}`, releaseTar());
    expect(first.code, first.out).toBe(0);
    expect(current(root)).toBe('v1.0.0');
    // The release reads the shared .env and keeps its Yjs files in the shared folder.
    const live = join(releases, 'v1.0.0', 'server');
    expect(readlinkSync(join(live, '.env')).replace(/\\/g, '/')).toMatch(/shared\/\.env$/);
    expect(readlinkSync(join(live, 'data', 'hocuspocus')).replace(/\\/g, '/')).toMatch(
      /shared\/hocuspocus\/?$/
    );

    // A release whose server is not the release it claims to be.
    const bad = run(`deploy v1.1.0 ${SHA}`, releaseTar('v0.0.0-wrong'));
    expect(bad.code, bad.out).not.toBe(0);
    expect(current(root)).toBe('v1.0.0');
    // The failed release is removed, so it never takes a good release's place.
    expect(readdirSync(releases)).not.toContain('v1.1.0');
    const log = readFileSync(join(root, 'shared', 'deploy.log'), 'utf8');
    expect(log).toMatch(/v1\.1\.0/);
    expect(log).toMatch(/schema_ahead: true/);
    // The previous release is serving again, with its own release.env.
    expect(readFileSync(join(root, 'shared', 'release.env'), 'utf8')).toMatch(
      /CHORD_RELEASE_TAG=v1\.0\.0/
    );

    // A migrate that fails stops before the flip, and logs no schema_ahead for it.
    const migrateFails = run(`deploy v1.1.1 ${SHA}`, releaseTar(), { DEPLOY_MIGRATE: 'exit 7' });
    expect(migrateFails.code, migrateFails.out).not.toBe(0);
    expect(current(root)).toBe('v1.0.0');
    expect(
      readFileSync(join(root, 'shared', 'deploy.log'), 'utf8').match(/schema_ahead: true/g)
    ).toHaveLength(1);

    // A migrate that fails after applying some files does log schema_ahead.
    const partly = run(`deploy v1.1.2 ${SHA}`, releaseTar(), {
      DEPLOY_MIGRATE: 'touch .migrated-partly; exit 7',
    });
    expect(partly.code, partly.out).not.toBe(0);
    expect(current(root)).toBe('v1.0.0');
    expect(
      readFileSync(join(root, 'shared', 'deploy.log'), 'utf8').match(/schema_ahead: true/g)
    ).toHaveLength(2);

    // Rerunning the live tag (a release.yml rerun) changes nothing and succeeds.
    const rerun = run(`deploy v1.0.0 ${SHA}`, releaseTar());
    expect(rerun.code, rerun.out).toBe(0);
    expect(current(root)).toBe('v1.0.0');

    for (const tag of ['v1.2.0', 'v1.3.0', 'v1.4.0-canary.1']) {
      const res = run(`deploy ${tag} ${SHA}`, releaseTar());
      expect(res.code, res.out).toBe(0);
    }
    expect(current(root)).toBe('v1.4.0-canary.1');
    // The newest three releases are kept, the live one among them.
    expect(readdirSync(releases).sort()).toEqual(['v1.2.0', 'v1.3.0', 'v1.4.0-canary.1']);
  });
});
