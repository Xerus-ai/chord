import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { expect, vi } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import type {
  AskScriptApproval,
  ScriptApprovalRequest,
} from '@main/core/workspaces/ask-script-approval';
import { recordLaneApproval, recordRepoApproval } from '@main/core/workspaces/script-approval';
import { resolveLaneBundle } from '@main/core/worktrees/lane-bundle';
import { db } from '@main/db/client';
import { repoSettings } from '@main/db/schema-repo-settings';
import { repos, workItems, workItemWorktrees } from '@main/db/schema-work-items';
import { runProcessOf, type RunProcess } from './run-process';

/**
 * A real repository with real lanes for the run engine's suites: a `main`
 * branch carrying the node scripts below and a `.chord.json`, lanes as real
 * `git worktree`s, and the rows the app keeps for them. The suite that uses
 * it substitutes `@main/db/client` with `createMigratedTestDb`.
 *
 * The scripts write what they saw into their working directory, so a suite
 * reads back where and with what env a process ran, and when a process was
 * told to stop.
 */

export const REPO_ID = 'repo-1';

/** Every script a suite commits to `main` under `scripts/`. */
const SCRIPTS: Record<string, string> = {
  // A dev server: prints its URL, records its pid, and on Ctrl+C says so and exits.
  'serve.cjs': [
    "const fs = require('node:fs');",
    'const port = Number(process.env.CHORD_PORT);',
    "const server = require('node:http').createServer((req, res) => res.end('served'));",
    "server.listen(port, '127.0.0.1', () => {",
    "  fs.writeFileSync('serve.pid', String(process.pid));",
    '  console.log(`listening on http://localhost:${port}`);',
    '});',
    "process.on('SIGINT', () => {",
    "  fs.writeFileSync('graceful.txt', 'stopped on Ctrl+C');",
    '  server.close();',
    '  process.exit(0);',
    '});',
  ].join('\n'),
  // A process that notes Ctrl+C and keeps running: only a kill ends it.
  'stubborn.cjs': [
    "const fs = require('node:fs');",
    "process.on('SIGINT', () => fs.writeFileSync('sigint-seen.txt', 'ignored'));",
    "fs.writeFileSync('stubborn.pid', String(process.pid));",
    "console.log('stubborn up');",
    'setInterval(() => {}, 1000);',
  ].join('\n'),
  // Records where it ran and the lane env it saw, then exits.
  'env.cjs': [
    "require('node:fs').writeFileSync('run-env.json', JSON.stringify({",
    '  port: process.env.CHORD_PORT,',
    '  laneId: process.env.CHORD_LANE_ID,',
    '  solo: process.env.CHORD_SOLO ?? null,',
    '  cwd: process.cwd(),',
    '}));',
  ].join('\n'),
  // Exits with the code it is given, after long enough to have a duration.
  'exit.cjs': 'setTimeout(() => process.exit(Number(process.argv[2])), 300);',
};

export async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: cwd }).exec(GIT_EXECUTABLE, args);
  return stdout.trim();
}

export interface LaneRepo {
  root: string;
  repoDir: string;
}

/** A repository on `main` with the scripts committed and nothing configured yet. */
export async function createLaneRepo(prefix: string): Promise<LaneRepo> {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const repoDir = path.join(root, 'repo');
  fs.mkdirSync(path.join(repoDir, 'scripts'), { recursive: true });
  await git(['init'], repoDir);
  await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], repoDir);
  await git(['config', 'user.email', 'test@test.com'], repoDir);
  await git(['config', 'user.name', 'Test'], repoDir);
  fs.writeFileSync(path.join(repoDir, '.gitignore'), '*.pid\n*.txt\nrun-env.json\n');
  for (const [name, source] of Object.entries(SCRIPTS)) {
    fs.writeFileSync(path.join(repoDir, 'scripts', name), `${source}\n`);
  }
  await git(['add', '.'], repoDir);
  await git(['commit', '-m', 'scripts'], repoDir);
  return { root, repoDir };
}

/** Commits `.chord.json` on `main` — the team file lanes read at their target ref. */
export async function commitTeamConfig(repoDir: string, config: object): Promise<void> {
  fs.writeFileSync(path.join(repoDir, '.chord.json'), JSON.stringify(config));
  await git(['add', '.chord.json'], repoDir);
  await git(['commit', '-m', 'config'], repoDir);
}

/** The repository row and one work item per id, as the app has them. */
export function insertRepoAndItems(repoDir: string, workItemIds: string[]): void {
  db.insert(repos).values({ id: REPO_ID, path: repoDir, alias: 'repo' }).run();
  for (const id of workItemIds) {
    db.insert(workItems).values({ id, name: id, repoId: REPO_ID, repoPath: repoDir }).run();
  }
}

/** A lane: a real checkout of a new branch off `main`, and its row. */
export async function addLane(args: {
  repo: LaneRepo;
  laneId: string;
  workItemId: string;
  dir: string;
  isPrimary?: boolean;
  setupStatus?: 'pending' | 'running' | 'ok' | 'failed' | 'skipped';
}): Promise<string> {
  const checkout = path.join(args.repo.root, 'pool', args.dir);
  await git(['worktree', 'add', '-b', `chord/${args.dir}`, checkout, 'main'], args.repo.repoDir);
  db.insert(workItemWorktrees)
    .values({
      id: args.laneId,
      workItemId: args.workItemId,
      path: checkout,
      branchName: `chord/${args.dir}`,
      isPrimary: args.isPrimary === false ? 0 : 1,
      targetRef: 'main',
      setupStatus: args.setupStatus ?? 'ok',
    })
    .run();
  return checkout;
}

export function readLaneRow(laneId: string) {
  return db.select().from(workItemWorktrees).where(eq(workItemWorktrees.id, laneId)).all()[0];
}

/** Approves, for this lane, exactly what it would run now. */
export async function approveLaneAsIs(laneId: string): Promise<void> {
  const { bundle } = await resolveLaneBundle(laneId);
  if (!bundle) throw new Error('nothing to approve');
  recordLaneApproval(laneId, bundle);
}

/** This machine's own scripts (Repo › Run & test, Just me), which run without asking. */
export function setJustMeScripts(scripts: Record<string, unknown>): void {
  db.insert(repoSettings)
    .values({ repoId: REPO_ID, overrides: JSON.stringify({ scripts }) })
    .run();
}

/** For content already approved, or the user's own: being asked at all fails the run. */
export const neverAsk: AskScriptApproval = async (request) => {
  throw new Error(`asked to approve ${request.bundle.hash}, which should not need asking`);
};

/** The user's answer, recorded the way the real prompt records it. */
export function answer(choice: 'run' | 'run-always' | 'dont-run'): {
  ask: AskScriptApproval;
  asked: ScriptApprovalRequest[];
} {
  const asked: ScriptApprovalRequest[] = [];
  const ask: AskScriptApproval = async (request) => {
    asked.push(request);
    if (choice === 'run') recordLaneApproval(request.laneId, request.bundle);
    if (choice === 'run-always') {
      recordRepoApproval({
        repoId: request.repoId,
        hash: request.bundle.hash,
        content: request.bundle.content,
        remoteUrl: request.remoteUrl,
      });
    }
    return choice === 'dont-run' ? 'skip' : 'run';
  };
  return { ask, asked };
}

/** The pid a script wrote to `file` once it was up. */
export async function waitForPid(file: string): Promise<number> {
  await vi.waitFor(() => expect(fs.existsSync(file)).toBe(true), { timeout: 15_000 });
  return Number(fs.readFileSync(file, 'utf8'));
}

/** The process that wrote its pid to `file`, read while it runs (`isRunning` checks it later). */
export async function waitForRunProcess(file: string): Promise<RunProcess> {
  return runProcessOf(await waitForPid(file));
}

/** The same folder, however the OS spells it (8.3 names, case, separators). */
export function samePath(a: string, b: string): boolean {
  return fs.realpathSync.native(a).toLowerCase() === fs.realpathSync.native(b).toLowerCase();
}

/**
 * Removes the suite's folder once the processes in it have let go: on
 * Windows a folder a process just left can stay locked for a moment, and
 * rmSync's own retries skip EPERM.
 */
export async function removeLaneRepo(repo: LaneRepo): Promise<void> {
  await vi.waitFor(() => fs.rmSync(repo.root, { recursive: true, force: true }), {
    timeout: 15_000,
  });
}
