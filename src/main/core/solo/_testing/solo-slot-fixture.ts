import fs from 'node:fs';
import path from 'node:path';
import { expect, vi } from 'vitest';
import {
  addLane,
  approveLaneAsIs,
  commitTeamConfig,
  createLaneRepo,
  git,
  type LaneRepo,
} from '@main/core/lane-runs/_testing/lane-run-fixture';
import { hashWorkingFiles } from './solo-repo-fixture';

/**
 * A repository in Solo run mode for the Solo slot's suites, on top of the run
 * engine's fixture (real repository, real lanes as `git worktree`s, the app's
 * rows): `main` carries a run script that records where and with what env it
 * runs and keeps running until Ctrl+C, and a test script that records where
 * it ran. Both write into their working directory under names `main`'s
 * `.gitignore` ignores (`*.txt`), as a dev server's logs would be.
 */

export const SOLO_RUN_SCRIPT = [
  "const fs = require('node:fs');",
  'const laneId = process.env.CHORD_LANE_ID;',
  'fs.writeFileSync(`solo-${laneId}.txt`, JSON.stringify({',
  '  pid: process.pid,',
  '  cwd: process.cwd(),',
  '  laneId,',
  '  solo: process.env.CHORD_SOLO ?? null,',
  '  rootPath: process.env.CHORD_ROOT_PATH ?? null,',
  '}));',
  "process.on('SIGINT', () => {",
  "  fs.writeFileSync(`stopped-${laneId}.txt`, 'ctrl+c');",
  '  process.exit(0);',
  '});',
  'setInterval(() => {}, 1000);',
].join('\n');

export const SOLO_TEST_SCRIPT = [
  "require('node:fs').writeFileSync(`test-${process.env.CHORD_LANE_ID}.txt`, JSON.stringify({",
  '  cwd: process.cwd(),',
  '  solo: process.env.CHORD_SOLO ?? null,',
  '}));',
].join('\n');

export const SOLO_TEAM_CONFIG = {
  runMode: 'solo',
  scripts: {
    run: { app: 'node scripts/solo-run.cjs' },
    test: 'node scripts/solo-test.cjs',
  },
};

/** The run engine's repository plus the Solo scripts and a Solo-mode `.chord.json` on `main`. */
export async function createSoloLaneRepo(prefix: string): Promise<LaneRepo> {
  const repo = await createLaneRepo(prefix);
  fs.writeFileSync(path.join(repo.repoDir, 'scripts', 'solo-run.cjs'), `${SOLO_RUN_SCRIPT}\n`);
  fs.writeFileSync(path.join(repo.repoDir, 'scripts', 'solo-test.cjs'), `${SOLO_TEST_SCRIPT}\n`);
  await git(['add', 'scripts'], repo.repoDir);
  await git(['commit', '-m', 'solo scripts'], repo.repoDir);
  await commitTeamConfig(repo.repoDir, SOLO_TEAM_CONFIG);
  return repo;
}

/**
 * A lane with a commit of its own (`<dir>.md`), so the root visibly holds
 * this lane and no other; approved as it is unless `approve` is false.
 */
export async function addSoloLane(
  repo: LaneRepo,
  args: { laneId: string; workItemId: string; dir: string; isPrimary?: boolean; approve?: boolean }
): Promise<string> {
  const checkout = await addLane({
    repo,
    laneId: args.laneId,
    workItemId: args.workItemId,
    dir: args.dir,
    isPrimary: args.isPrimary,
  });
  fs.writeFileSync(path.join(checkout, `${args.dir}.md`), `work of ${args.dir}\n`);
  await git(['add', '.'], checkout);
  await git(['commit', '-m', `${args.dir} work`], checkout);
  if (args.approve !== false) await approveLaneAsIs(args.laneId);
  return checkout;
}

export interface SoloRunMark {
  pid: number;
  cwd: string;
  laneId: string;
  solo: string | null;
  rootPath: string | null;
}

function readMark<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8');
  return raw ? (JSON.parse(raw) as T) : null;
}

/** What the lane's run script recorded in `dir`, once it has (and, given `notPid`, once a new one has). */
export async function waitForRunMark(
  dir: string,
  laneId: string,
  notPid?: number
): Promise<SoloRunMark> {
  const file = path.join(dir, `solo-${laneId}.txt`);
  let mark: SoloRunMark | null = null;
  await vi.waitFor(
    () => {
      mark = readMark<SoloRunMark>(file);
      expect(mark).not.toBeNull();
      if (notPid !== undefined) expect(mark!.pid).not.toBe(notPid);
    },
    { timeout: 15_000 }
  );
  return mark!;
}

export async function waitForTestMark(
  dir: string,
  laneId: string
): Promise<{ cwd: string; solo: string | null }> {
  const file = path.join(dir, `test-${laneId}.txt`);
  let mark: { cwd: string; solo: string | null } | null = null;
  await vi.waitFor(
    () => {
      mark = readMark(file);
      expect(mark).not.toBeNull();
    },
    { timeout: 15_000 }
  );
  return mark!;
}

/** Whether the lane's run script saw Ctrl+C in `dir`. */
export function sawCtrlC(dir: string, laneId: string): boolean {
  return fs.existsSync(path.join(dir, `stopped-${laneId}.txt`));
}

const RUN_OUTPUT = /^(solo|stopped|test)-.*\.txt$/;

/**
 * sha256 of every file in the root, ignored ones included, except what the
 * Solo runs wrote there: ignored output a run creates stays in the root on
 * release by design (`restoreRecordedRoot`).
 */
export function hashRootFiles(root: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(hashWorkingFiles(root)).filter(([file]) => !RUN_OUTPUT.test(file))
  );
}

export async function headOf(dir: string): Promise<string> {
  return git(['rev-parse', 'HEAD'], dir);
}

/** The checked-out branch, or `HEAD` when detached. */
export async function branchOf(dir: string): Promise<string> {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], dir);
}

export async function statusOf(dir: string): Promise<string> {
  return git(['status', '--porcelain', '--untracked-files=all'], dir);
}
