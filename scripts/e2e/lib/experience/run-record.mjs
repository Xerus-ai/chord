import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A record of each e2e run that drove the app, for the review a person (or
 * the agent) owes it: what the user saw in its screenshots, what went wrong,
 * and a verdict. Passing checks are not that review; on 2026-10-02 a suite
 * passed while the owner's chat filled with agent noise.
 *
 * `launchSeededApp` starts the record on a process's first launch, so every
 * suite that drives the app is covered without opting in. When the process
 * exits it writes `.e2e-runs/<suite>-<start>.json`: the suite, its exit code,
 * every screenshot written during the run and, with CHORD_E2E_VIDEO set, the
 * video of each launch (the harness proof slot asks for one). `gate.ps1 complete` refuses
 * while a run recorded in the workflow has no `<same name>.review.md` (see
 * OPERATIONS.md §3d).
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const RUNS_DIR = join(ROOT, '.e2e-runs');
/** Where every e2e suite writes its screenshots (and where a run's are listed from). */
export const E2E_SHOTS_DIR = join(ROOT, 'screenshots', 'e2e');
/** Where a launch records its video when CHORD_E2E_VIDEO is set (`launchSeededApp`). */
export const E2E_VIDEO_DIR = join(E2E_SHOTS_DIR, 'video');

let startedAt = null;

function screenshotsSince(since) {
  // A suite that took no screenshots has never made the folder.
  if (!existsSync(E2E_SHOTS_DIR)) return [];
  return readdirSync(E2E_SHOTS_DIR)
    .filter((name) => name.endsWith('.png'))
    .filter((name) => statSync(join(E2E_SHOTS_DIR, name)).mtimeMs >= since)
    .sort()
    .map((name) => join('screenshots', 'e2e', name));
}

function videosSince(since) {
  if (!existsSync(E2E_VIDEO_DIR)) return [];
  return readdirSync(E2E_VIDEO_DIR)
    .filter((name) => name.endsWith('.webm'))
    .filter((name) => statSync(join(E2E_VIDEO_DIR, name)).mtimeMs >= since)
    .sort()
    .map((name) => join('screenshots', 'e2e', 'video', name));
}

export function recordRunOnExit() {
  if (startedAt !== null) return;
  startedAt = Date.now();
  const suite = basename(process.argv[1] ?? 'unknown', '.mjs');
  process.on('exit', (code) => {
    const name = `${suite}-${startedAt}`;
    mkdirSync(RUNS_DIR, { recursive: true });
    writeFileSync(
      join(RUNS_DIR, `${name}.json`),
      `${JSON.stringify(
        {
          suite,
          started_at: new Date(startedAt).toISOString(),
          finished_at: new Date().toISOString(),
          exit_code: process.exitCode ?? code,
          screenshots: screenshotsSince(startedAt),
          videos: videosSince(startedAt),
          review: join('.e2e-runs', `${name}.review.md`),
        },
        null,
        2
      )}\n`
    );
  });
}
