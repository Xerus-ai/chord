import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import type {
  AskScriptApproval,
  ScriptApprovalRequest,
} from '@main/core/workspaces/ask-script-approval';
import { recordLaneApproval, recordRepoApproval } from '@main/core/workspaces/script-approval';
import { db } from '@main/db/client';
import { repoSettings } from '@main/db/schema-repo-settings';
import { repos, workItems, workItemWorktrees } from '@main/db/schema-work-items';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { resolveLaneBundle } from './lane-bundle';
import { waitForLane } from './lane-readiness';
import { readLaneSetupLog, runLaneSetup } from './lane-setup';

const waitForLaneSetup = (laneId: string) => waitForLane(laneId, 'setup');

vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

// The IPC emitter needs Electron's main process; what is under test here is
// the state the emitter would announce, which is read back from the database.
const emitted = vi.hoisted(() => [] as unknown[]);
vi.mock('@main/lib/events', () => ({
  events: { emit: (_channel: unknown, payload: unknown) => emitted.push(payload) },
}));

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: cwd }).exec(GIT_EXECUTABLE, args);
  return stdout.trim();
}

/** Writes `value` to `file` in the checkout — portable across cmd and sh. */
function writeMarker(file: string, value: string): string {
  return `node -e "require('fs').writeFileSync('${file}', ${value})"`;
}

const REPO_ID = 'repo-1';
const ITEM_ID = 'item-1';
const LANE_ID = 'lane-1';
const SECOND_ITEM_ID = 'item-2';
const SECOND_LANE_ID = 'lane-2';

/** For content already approved: being asked at all fails the run. */
const neverAsk: AskScriptApproval = async (request) => {
  throw new Error(`asked to approve ${request.bundle.hash}, which should already be approved`);
};

/** The user's answer, recorded the way the real prompt records it. */
function answer(choice: 'run' | 'run-always' | 'dont-run'): {
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

describe('lane setup', () => {
  let root: string;
  let repoDir: string;
  let lanePath: string;

  async function commitConfig(config: object): Promise<void> {
    fs.writeFileSync(path.join(repoDir, '.chord.json'), JSON.stringify(config));
    await git(['add', '.chord.json'], repoDir);
    await git(['commit', '-m', 'config'], repoDir);
  }

  async function createLane(laneId = LANE_ID, workItemId = ITEM_ID, dir = 'lane'): Promise<string> {
    const checkout = path.join(root, 'pool', dir);
    await git(['worktree', 'add', '-b', `chord/${dir}`, checkout, 'main'], repoDir);
    db.insert(workItemWorktrees)
      .values({
        id: laneId,
        workItemId,
        path: checkout,
        branchName: `chord/${dir}`,
        isPrimary: 1,
        targetRef: 'main',
        setupStatus: 'pending',
      })
      .run();
    return checkout;
  }

  /** Approves, for this lane, exactly what it would run now. */
  async function approveLaneAsIs(laneId = LANE_ID): Promise<void> {
    const { bundle } = await resolveLaneBundle(laneId);
    if (!bundle) throw new Error('nothing to approve');
    recordLaneApproval(laneId, bundle);
  }

  function laneRow(laneId = LANE_ID) {
    return db.select().from(workItemWorktrees).where(eq(workItemWorktrees.id, laneId)).all()[0];
  }

  beforeEach(async () => {
    emitted.length = 0;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-setup-'));
    repoDir = path.join(root, 'repo');
    fs.mkdirSync(repoDir);
    await git(['init'], repoDir);
    await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], repoDir);
    await git(['config', 'user.email', 'test@test.com'], repoDir);
    await git(['config', 'user.name', 'Test'], repoDir);
    fs.writeFileSync(path.join(repoDir, '.gitignore'), '.env\nmarker.txt\n');
    await git(['add', '.gitignore'], repoDir);
    await git(['commit', '-m', 'init'], repoDir);

    db.insert(repos).values({ id: REPO_ID, path: repoDir, alias: 'repo' }).run();
    db.insert(workItems)
      .values({ id: ITEM_ID, name: 'item', repoId: REPO_ID, repoPath: repoDir })
      .run();
    db.insert(workItems)
      .values({ id: SECOND_ITEM_ID, name: 'second', repoId: REPO_ID, repoPath: repoDir })
      .run();
  });

  afterEach(() => {
    db.delete(workItems).run();
    db.delete(repos).run();
    removeDirSync(root);
  });

  it("runs an approved setup script in the checkout with the lane's env", async () => {
    await commitConfig({
      scripts: { setup: writeMarker('marker.txt', 'process.env.CHORD_LANE_ID') },
    });
    lanePath = await createLane();
    await approveLaneAsIs();

    expect(await runLaneSetup(LANE_ID, neverAsk)).toBe('ok');

    expect(fs.readFileSync(path.join(lanePath, 'marker.txt'), 'utf8')).toBe(LANE_ID);
    expect(laneRow().setupStatus).toBe('ok');
    expect(laneRow().setupLogPath).toBeTruthy();
    expect(emitted).toContainEqual(expect.objectContaining({ worktreeId: LANE_ID, status: 'ok' }));
  });

  it('keeps the checkout and records the log when the script fails', async () => {
    await commitConfig({
      scripts: { setup: `node -e "console.log('installing'); process.exit(3)"` },
    });
    lanePath = await createLane();
    await approveLaneAsIs();

    expect(await runLaneSetup(LANE_ID, neverAsk)).toBe('failed');

    expect(laneRow().setupStatus).toBe('failed');
    expect(fs.existsSync(lanePath)).toBe(true);
    const log = await readLaneSetupLog(LANE_ID);
    expect(log).toContain('installing');
    expect(log).toMatch(/exit(ed)? (with )?code 3/i);
  });

  it('records the failure, without rejecting, when the checkout goes away during setup', async () => {
    // The lane archived or deleted while its setup runs: its git dir, where
    // the log is, is gone by the time the failure is written down.
    await commitConfig({
      scripts: {
        setup: `node -e "const d=require('child_process').execSync('git rev-parse --absolute-git-dir').toString().trim(); require('fs').rmSync(d,{recursive:true,force:true}); process.exit(1)"`,
      },
    });
    lanePath = await createLane();
    await approveLaneAsIs();

    expect(await runLaneSetup(LANE_ID, neverAsk)).toBe('failed');
    expect(laneRow().setupStatus).toBe('failed');
  });

  it('asks once, showing what will run, and runs it after Run scripts', async () => {
    const setup = writeMarker('marker.txt', "'ran'");
    await commitConfig({ scripts: { setup }, shellSetup: 'echo hi' });
    lanePath = await createLane();
    const { ask, asked } = answer('run');

    expect(await runLaneSetup(LANE_ID, ask)).toBe('ok');

    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      laneId: LANE_ID,
      repoId: REPO_ID,
      repoPath: repoDir,
      ref: 'main',
      remoteUrl: null,
      bundle: { content: { chord: { setup, shellSetup: 'echo hi' }, claude: {} } },
    });
    expect(fs.readFileSync(path.join(lanePath, 'marker.txt'), 'utf8')).toBe('ran');
  });

  it("skips setup on Don't run, says how to run it, records nothing, and asks again next time", async () => {
    await commitConfig({ scripts: { setup: writeMarker('marker.txt', "'ran'") } });
    lanePath = await createLane();

    expect(await runLaneSetup(LANE_ID, answer('dont-run').ask)).toBe('skipped');

    expect(laneRow().setupStatus).toBe('skipped');
    expect(laneRow().approvedScriptsHash).toBeNull();
    expect(fs.existsSync(path.join(lanePath, 'marker.txt'))).toBe(false);
    expect(await readLaneSetupLog(LANE_ID)).toMatch(/not run.*Run setup/i);
    expect(emitted).toContainEqual(
      expect.objectContaining({ worktreeId: LANE_ID, status: 'skipped' })
    );

    const { ask, asked } = answer('run');
    expect(await runLaneSetup(LANE_ID, ask)).toBe('ok');
    expect(asked).toHaveLength(1);
  });

  it('does not ask a second lane of the repository after Always trust', async () => {
    await commitConfig({ scripts: { setup: writeMarker('marker.txt', "'ran'") } });
    await createLane();
    const second = await createLane(SECOND_LANE_ID, SECOND_ITEM_ID, 'second');

    expect(await runLaneSetup(LANE_ID, answer('run-always').ask)).toBe('ok');
    expect(await runLaneSetup(SECOND_LANE_ID, neverAsk)).toBe('ok');

    expect(fs.readFileSync(path.join(second, 'marker.txt'), 'utf8')).toBe('ran');
  });

  it('asks the second lane again after a lane-only approval', async () => {
    await commitConfig({ scripts: { setup: writeMarker('marker.txt', "'ran'") } });
    await createLane();
    await createLane(SECOND_LANE_ID, SECOND_ITEM_ID, 'second');

    expect(await runLaneSetup(LANE_ID, answer('run').ask)).toBe('ok');
    const { ask, asked } = answer('run');
    expect(await runLaneSetup(SECOND_LANE_ID, ask)).toBe('ok');
    expect(asked).toHaveLength(1);
  });

  it('asks again when the target ref changes the script after approval', async () => {
    await commitConfig({ scripts: { setup: writeMarker('marker.txt', "'first'") } });
    lanePath = await createLane();
    await approveLaneAsIs();
    await commitConfig({ scripts: { setup: writeMarker('marker.txt', "'changed'") } });

    const { ask, asked } = answer('run');
    expect(await runLaneSetup(LANE_ID, ask)).toBe('ok');

    expect(asked).toHaveLength(1);
    expect(fs.readFileSync(path.join(lanePath, 'marker.txt'), 'utf8')).toBe('changed');
  });

  it("runs the target ref's script, not the agent's edit in the checkout", async () => {
    await commitConfig({ scripts: { setup: writeMarker('marker.txt', "'trusted'") } });
    lanePath = await createLane();
    await approveLaneAsIs();
    fs.writeFileSync(
      path.join(lanePath, '.chord.json'),
      JSON.stringify({ scripts: { setup: writeMarker('marker.txt', "'agent'") } })
    );
    await git(['commit', '-am', 'agent edit'], lanePath);

    expect(await runLaneSetup(LANE_ID, neverAsk)).toBe('ok');

    expect(fs.readFileSync(path.join(lanePath, 'marker.txt'), 'utf8')).toBe('trusted');
  });

  it("includes the checkout's Claude config that runs code in what it asks about", async () => {
    await commitConfig({ scripts: { setup: writeMarker('marker.txt', "'ran'") } });
    fs.writeFileSync(
      path.join(repoDir, '.mcp.json'),
      JSON.stringify({ mcpServers: { s: { command: 'node' } } })
    );
    await git(['add', '.mcp.json'], repoDir);
    await git(['commit', '-m', 'mcp'], repoDir);
    await createLane();
    const { ask, asked } = answer('run');

    expect(await runLaneSetup(LANE_ID, ask)).toBe('ok');

    expect(asked[0].bundle.content.claude).toEqual({ mcpServers: { s: { command: 'node' } } });
  });

  it('fails setup, visibly, on an invalid .chord.json', async () => {
    fs.writeFileSync(path.join(repoDir, '.chord.json'), '{ "scripts": ');
    await git(['add', '.chord.json'], repoDir);
    await git(['commit', '-m', 'broken config'], repoDir);
    await createLane();

    expect(await runLaneSetup(LANE_ID, neverAsk)).toBe('failed');

    expect(await readLaneSetupLog(LANE_ID)).toContain('.chord.json');
  });

  it('copies gitignored files before the script runs', async () => {
    fs.writeFileSync(path.join(repoDir, '.env'), 'SECRET=abc');
    await commitConfig({
      filesToCopy: ['.env'],
      scripts: {
        setup: writeMarker('marker.txt', "require('fs').readFileSync('.env', 'utf8')"),
      },
    });
    lanePath = await createLane();
    await approveLaneAsIs();

    expect(await runLaneSetup(LANE_ID, neverAsk)).toBe('ok');

    expect(fs.readFileSync(path.join(lanePath, 'marker.txt'), 'utf8')).toBe('SECRET=abc');
  });

  it("runs the user's own setup script without asking, in place of the team's", async () => {
    await commitConfig({
      scripts: { setup: writeMarker('marker.txt', "'team'") },
      shellSetup: 'x',
    });
    db.insert(repoSettings)
      .values({
        repoId: REPO_ID,
        overrides: JSON.stringify({ scripts: { setup: writeMarker('marker.txt', "'mine'") } }),
      })
      .run();
    lanePath = await createLane();

    expect(await runLaneSetup(LANE_ID, neverAsk)).toBe('ok');

    expect(fs.readFileSync(path.join(lanePath, 'marker.txt'), 'utf8')).toBe('mine');
  });

  it('is ok straight away, without asking, when the repository declares no setup script', async () => {
    await commitConfig({ shellSetup: 'echo hi' });
    await createLane();

    expect(await runLaneSetup(LANE_ID, neverAsk)).toBe('ok');
    expect(laneRow().setupStatus).toBe('ok');
  });

  it('holds waiters until setup succeeds — through a failure and a retry', async () => {
    await commitConfig({ scripts: { setup: `node -e "process.exit(1)"` } });
    await createLane();
    await approveLaneAsIs();

    let released = false;
    const waiting = waitForLaneSetup(LANE_ID).then(() => {
      released = true;
    });

    expect(await runLaneSetup(LANE_ID, neverAsk)).toBe('failed');
    await new Promise((r) => setTimeout(r, 50));
    expect(released).toBe(false);

    // The fix lands on the target ref and the user approves it.
    await commitConfig({ scripts: { setup: `node -e "process.exit(0)"` } });
    await approveLaneAsIs();
    expect(await runLaneSetup(LANE_ID, neverAsk)).toBe('ok');

    await waiting;
    expect(released).toBe(true);
  });

  it("releases waiters when the user chose Don't run", async () => {
    await commitConfig({ scripts: { setup: writeMarker('marker.txt', "'ran'") } });
    await createLane();

    const waiting = waitForLaneSetup(LANE_ID);
    expect(await runLaneSetup(LANE_ID, answer('dont-run').ask)).toBe('skipped');

    await expect(waiting).resolves.toBeUndefined();
  });

  it('does not hold waiters for a lane whose setup is not tracked', async () => {
    const legacy = path.join(root, 'pool', 'legacy');
    await git(['worktree', 'add', '-b', 'chord/legacy', legacy, 'main'], repoDir);
    db.insert(workItemWorktrees)
      .values({ id: LANE_ID, workItemId: ITEM_ID, path: legacy, isPrimary: 1 })
      .run();

    await expect(waitForLaneSetup(LANE_ID)).resolves.toBeUndefined();
  });
});
