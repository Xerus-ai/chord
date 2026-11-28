import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
        // Records each run, so a case can see the store prune happen after `live`.
        DEPLOY_STORE_PRUNE: `echo store-pruned >> '${r}/shared/deploy.log'`,
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

  // devstation-mg6u.74: release readiness compares the box's deploy.sh with main's through the
  // deploy key, which gets no shell, so the script itself answers with its own hash.
  it('deploy.sh answers version with its own sha256 and touches nothing', async () => {
    const { root, run } = await box();
    const want = createHash('sha256').update(readFileSync(DEPLOY_SH)).digest('hex');
    const res = run('version');
    expect(res.code, res.out).toBe(0);
    expect(res.out.trim()).toBe(want);
    for (const request of ['version x', 'version;id', ' version', 'version\nid']) {
      expect(run(request).code, `request ${JSON.stringify(request)}`).toBe(2);
    }
    expect(readdirSync(root)).toEqual([]);
  });

  // devstation-75ba: the release-health loop reads the box through the deploy key, which gets no
  // shell, so the script answers `status` itself: disk use and the newest schema_ahead line. The
  // bugs: a status that creates the deploy root, misses the newest line, or lets a variant through.
  it('deploy.sh answers status with disk use and the newest schema_ahead time, touching nothing', async () => {
    const { root, run } = await box();
    const empty = run('status');
    expect(empty.code, empty.out).toBe(0);
    expect(empty.out).toMatch(/^disk_used_pct \d{1,3}$/m);
    expect(empty.out).toMatch(/^schema_ahead_last none$/m);
    expect(readdirSync(root)).toEqual([]);

    mkdirSync(join(root, 'shared'), { recursive: true });
    writeFileSync(
      join(root, 'shared', 'deploy.log'),
      [
        '2026-11-01T10:00:00Z v1.0.0 schema_ahead: true (migrations of v1.0.0 are applied; the live release runs on them)',
        '2026-11-02T10:00:00Z v1.0.1 live',
        '2026-11-03T10:00:00Z v1.0.2 schema_ahead: true (migrations of v1.0.2 are applied; the live release runs on them)',
        '2026-11-04T10:00:00Z v1.0.3 live',
        '',
      ].join('\n')
    );
    const logged = run('status');
    expect(logged.code, logged.out).toBe(0);
    expect(logged.out).toMatch(/^schema_ahead_last 2026-11-03T10:00:00Z$/m);
    expect(readdirSync(root)).toEqual(['shared']);
    for (const request of ['status x', 'status;id', ' status', 'status\nid']) {
      expect(run(request).code, `request ${JSON.stringify(request)}`).toBe(2);
    }
  });

  // Verifier (PR #50): an unreadable deploy.log read as "none" and a missing deploy root measured
  // as `/` would both pass as healthy; status fails instead.
  it('deploy.sh status fails on an unreadable deploy.log and on a missing deploy root', async () => {
    const { root, run } = await box();
    mkdirSync(join(root, 'shared', 'deploy.log'), { recursive: true });
    const unreadable = run('status');
    expect(unreadable.code, unreadable.out).toBe(1);
    expect(unreadable.out).not.toMatch(/schema_ahead_last none/);
    const missing = run('status', undefined, { DEPLOY_ROOT: join(root, 'not-there').replace(/\\/g, '/') });
    expect(missing.code, missing.out).toBe(1);
    expect(missing.out).not.toMatch(/disk_used_pct/);
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

  // devstation-mg6u.9: the deploy user's pnpm store only grew; it is pruned after each live
  // release, and a prune that fails fails the deploy without taking the release down.
  it(
    'prunes the pnpm store after a live release; a failed prune exits 1 and stays live',
    { timeout: 120_000 },
    async () => {
      const { root, run } = await box();
      mkdirSync(join(root, 'shared'), { recursive: true });
      writeFileSync(join(root, 'shared', '.env'), 'MIGRATE_DATABASE_URL=postgres://unused\n');
      const ok = run(`deploy v2.0.0 ${SHA}`, releaseTar());
      expect(ok.code, ok.out).toBe(0);
      const log = readFileSync(join(root, 'shared', 'deploy.log'), 'utf8');
      expect(log.indexOf('store-pruned'), log).toBeGreaterThan(log.lastIndexOf('live'));

      const failed = run(`deploy v2.1.0 ${SHA}`, releaseTar(), { DEPLOY_STORE_PRUNE: 'exit 9' });
      expect(failed.code, failed.out).toBe(1);
      expect(current(root)).toBe('v2.1.0');
      expect(readFileSync(join(root, 'shared', 'deploy.log'), 'utf8')).toMatch(
        /store prune failed/
      );
    }
  );
});

// devstation-mg6u.9: the Caddyfile names no host; bootstrap renders it from CHORD_API_HOST.
describe('render-caddyfile.sh', () => {
  const RENDER = join(HERE, '..', '..', 'server', 'deploy', 'render-caddyfile.sh');
  const TEMPLATE = join(HERE, '..', '..', 'server', 'deploy', 'Caddyfile');
  const render = (env: Record<string, string>) => {
    const out = join(temp('caddy-'), 'Caddyfile');
    const base = { ...process.env };
    delete base.CHORD_API_HOST;
    const res = spawnSync(BASH, [RENDER, TEMPLATE, out], {
      encoding: 'utf8',
      env: { ...base, ...env },
    });
    return { code: res.status, out: `${res.stdout}${res.stderr}`, file: out };
  };

  it('refuses without CHORD_API_HOST and writes nothing', () => {
    const res = render({});
    expect(res.code, res.out).not.toBe(0);
    expect(res.out).toMatch(/CHORD_API_HOST/);
    expect(existsSync(res.file)).toBe(false);
  });

  it('writes the given host on both listeners and no placeholder', () => {
    const res = render({ CHORD_API_HOST: 'api.example.test' });
    expect(res.code, res.out).toBe(0);
    const text = readFileSync(res.file, 'utf8');
    expect(text).toMatch(/^api\.example\.test \{$/m);
    expect(text).toMatch(/^api\.example\.test:1235 \{$/m);
    expect(text).not.toMatch(/CHORD_API_HOST/);
  });
});
