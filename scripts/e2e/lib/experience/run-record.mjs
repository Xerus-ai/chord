import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A record of each e2e run that drove the app, for the review a person (or
 * the agent) owes it: what the user saw in its screenshots, what went wrong,
 * and a verdict. Passing checks are not that review; on 2026-10-02 a suite
 * passed while the owner's chat filled with agent noise.
 *
 * Every artifact an e2e run writes lives under one output root:
 * `CHORD_E2E_OUT_DIR` when it is set (a test harness keeps runs outside the
 * repo that way), otherwise `<repo>/.e2e-out/`, one git-ignored folder:
 *
 *   runs/<suite>-<start>.json   the run record (and its <same name>.review.md)
 *   screenshots/                every screenshot a suite takes
 *   videos/                     a video per launch, with CHORD_E2E_VIDEO set
 *   logs/                       a run's console output, when its runner redirects it there
 *   perf/                       the perf benches' results (scripts/perf)
 *   ui-identity/<label>/        the UI identity captures (suites/ui-identity.mjs)
 *
 * `launchSeededApp` starts the record on a process's first launch, so every
 * suite that drives the app is covered without opting in. When the process
 * exits it writes `runs/<suite>-<start>.json`: the suite, its exit code, every
 * screenshot written during the run and, with CHORD_E2E_VIDEO set, the video
 * of each launch, as paths relative to the output root.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
/** The one folder every e2e artifact is written under. */
export const E2E_OUT_DIR = process.env.CHORD_E2E_OUT_DIR
  ? resolve(process.env.CHORD_E2E_OUT_DIR)
  : join(ROOT, '.e2e-out');
/** Where the run records and their reviews are written. */
export const E2E_RUNS_DIR = join(E2E_OUT_DIR, 'runs');
/** Where every e2e suite writes its screenshots (and where a run's are listed from). */
export const E2E_SHOTS_DIR = join(E2E_OUT_DIR, 'screenshots');
/** Where a launch records its video when CHORD_E2E_VIDEO is set (`launchSeededApp`). */
export const E2E_VIDEO_DIR = join(E2E_OUT_DIR, 'videos');
/** Where a run's console output goes when its runner redirects it (`> "$CHORD_E2E_OUT_DIR/logs/<suite>.log"`). */
export const E2E_LOGS_DIR = join(E2E_OUT_DIR, 'logs');
/** Where the perf benches (scripts/perf) append their results. */
export const E2E_PERF_DIR = join(E2E_OUT_DIR, 'perf');

let startedAt = null;

/** The files of `dir` with `extension` written since `since`, as `<folder>/<name>` under the output root. */
function filesSince(dir, extension, since) {
  // A suite that took no screenshots has never made the folder.
  if (!existsSync(dir)) return [];
  const folder = basename(dir);
  return readdirSync(dir)
    .filter((name) => name.endsWith(extension))
    .filter((name) => statSync(join(dir, name)).mtimeMs >= since)
    .sort()
    .map((name) => `${folder}/${name}`);
}

/**
 * The run's start on the file system's clock. A file's mtime comes from the kernel's coarse
 * clock, which on Linux can lag Date.now() by a few milliseconds, so a screenshot written right
 * after the start could read as older than a Date.now() start and drop out of the record. A
 * file stamped at the start carries the same clock as the files the run writes.
 */
function fileClockNow(name) {
  mkdirSync(E2E_RUNS_DIR, { recursive: true });
  const stamp = join(E2E_RUNS_DIR, `.${name}.start`);
  writeFileSync(stamp, '');
  const { mtimeMs } = statSync(stamp);
  unlinkSync(stamp);
  return mtimeMs;
}

export function recordRunOnExit() {
  if (startedAt !== null) return;
  startedAt = Date.now();
  const suite = basename(process.argv[1] ?? 'unknown', '.mjs');
  const since = fileClockNow(`${suite}-${startedAt}`);
  process.on('exit', (code) => {
    const name = `${suite}-${startedAt}`;
    mkdirSync(E2E_RUNS_DIR, { recursive: true });
    writeFileSync(
      join(E2E_RUNS_DIR, `${name}.json`),
      `${JSON.stringify(
        {
          suite,
          started_at: new Date(startedAt).toISOString(),
          finished_at: new Date().toISOString(),
          exit_code: process.exitCode ?? code,
          screenshots: filesSince(E2E_SHOTS_DIR, '.png', since),
          videos: filesSince(E2E_VIDEO_DIR, '.webm', since),
          review: `runs/${name}.review.md`,
        },
        null,
        2
      )}\n`
    );
  });
}
