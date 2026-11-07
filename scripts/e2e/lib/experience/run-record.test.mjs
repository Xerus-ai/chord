import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const RUN_RECORD = join(dirname(fileURLToPath(import.meta.url)), 'run-record.mjs');
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/**
 * Every artifact of an e2e run lives under one output root, so run output never
 * spreads over the repo: CHORD_E2E_OUT_DIR when set, `<repo>/.e2e-out/` otherwise.
 * A real suite process writes a screenshot and a video and exits; its record lands
 * in `<root>/runs/` and names its files relative to that root.
 */
describe('run record output root', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'run-record-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Runs a suite file `name`.mjs that records a run, writes one screenshot and one video, and exits with `code`. */
  function runSuite(name, env, code) {
    const suite = join(dir, `${name}.mjs`);
    writeFileSync(
      suite,
      [
        "import { mkdirSync, writeFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        `import { E2E_SHOTS_DIR, E2E_VIDEO_DIR, recordRunOnExit } from ${JSON.stringify(pathToFileURL(RUN_RECORD).href)};`,
        'recordRunOnExit();',
        'mkdirSync(E2E_SHOTS_DIR, { recursive: true });',
        'mkdirSync(E2E_VIDEO_DIR, { recursive: true });',
        "writeFileSync(join(E2E_SHOTS_DIR, 'shell-01.png'), 'png');",
        "writeFileSync(join(E2E_VIDEO_DIR, 'launch.webm'), 'webm');",
        `process.exitCode = ${code};`,
      ].join('\n')
    );
    try {
      execFileSync(process.execPath, [suite], { env, stdio: 'pipe' });
    } catch (e) {
      if (e.status !== code) throw e;
    }
  }

  it('writes the record, screenshots and videos under CHORD_E2E_OUT_DIR', () => {
    const out = join(dir, 'out');
    runSuite('rail-check', { ...process.env, CHORD_E2E_OUT_DIR: out }, 3);

    const records = readdirSync(join(out, 'runs'));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatch(/^rail-check-\d+\.json$/);
    const record = JSON.parse(readFileSync(join(out, 'runs', records[0]), 'utf8'));
    expect(record.suite).toBe('rail-check');
    expect(record.exit_code).toBe(3);
    expect(record.screenshots).toEqual(['screenshots/shell-01.png']);
    expect(record.videos).toEqual(['videos/launch.webm']);
    expect(record.review).toBe(`runs/${records[0].replace(/\.json$/, '.review.md')}`);
    expect(readdirSync(out).sort()).toEqual(['runs', 'screenshots', 'videos']);
  });

  it('defaults the output root to <repo>/.e2e-out when CHORD_E2E_OUT_DIR is unset', () => {
    const env = { ...process.env };
    delete env.CHORD_E2E_OUT_DIR;
    const printed = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const r = await import(${JSON.stringify(pathToFileURL(RUN_RECORD).href)}); console.log(JSON.stringify([r.E2E_OUT_DIR, r.E2E_RUNS_DIR, r.E2E_SHOTS_DIR, r.E2E_VIDEO_DIR, r.E2E_LOGS_DIR, r.E2E_PERF_DIR]));`,
      ],
      { env, encoding: 'utf8' }
    );
    const out = join(REPO, '.e2e-out');
    expect(JSON.parse(printed)).toEqual([
      out,
      join(out, 'runs'),
      join(out, 'screenshots'),
      join(out, 'videos'),
      join(out, 'logs'),
      join(out, 'perf'),
    ]);
  });
});
