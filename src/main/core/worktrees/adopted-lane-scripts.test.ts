import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import type {
  AskScriptApproval,
  ScriptApprovalRequest,
} from '@main/core/workspaces/ask-script-approval';
import { recordLaneApproval, recordRepoApproval } from '@main/core/workspaces/script-approval';
import { renderTrustPromptPage } from '@main/core/workspaces/trust-prompt-page';
import { db } from '@main/db/client';
import { repoSettings } from '@main/db/schema-repo-settings';
import { repos, workItems, workItemWorktrees } from '@main/db/schema-work-items';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { resolveLaneBundle } from './lane-bundle';
import { resolveApprovedLaneScripts } from './lane-config';
import { readLaneSetupLog, runLaneSetup } from './lane-setup';

/**
 * What runs in an adopted checkout (plan §Phase 3 slice 6): Chord never
 * changes the user's files, so Run setup's file copy keeps a file the
 * checkout already has — its `.env` survives — and says so in the log, and
 * the lane never runs a teardown, the team's or the user's own — so its trust
 * prompt doesn't list one and its approval doesn't cover one
 * (devstation-lze). A lane Chord made keeps its teardown. Real repository,
 * real schema, real approvals.
 */
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

// The IPC emitter needs Electron's main process; the state it would announce
// is read back from the database.
vi.mock('@main/lib/events', () => ({ events: { emit: () => {} } }));

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: cwd }).exec(GIT_EXECUTABLE, args);
  return stdout.trim();
}

/** Nothing here needs approving: being asked at all fails the run. */
const neverAsk: AskScriptApproval = async (request) => {
  throw new Error(`asked to approve ${request.bundle.hash}`);
};

const REPO_ID = 'repo-1';
const ITEM_ID = 'item-1';
const ADOPTED = 'lane-adopted';
const CHORD = 'lane-chord';

describe('scripts in an adopted checkout', () => {
  let root: string;
  let repoDir: string;
  let adoptedPath: string;
  let chordPath: string;

  function insertLane(id: string, folder: string, isPrimary: boolean, origin: 'chord' | 'adopted') {
    db.insert(workItemWorktrees)
      .values({
        id,
        workItemId: ITEM_ID,
        path: folder,
        isPrimary: isPrimary ? 1 : 0,
        targetRef: 'main',
        setupStatus: origin === 'adopted' ? 'skipped' : 'ok',
        checkoutOrigin: origin,
      })
      .run();
  }

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'adopted-scripts-'));
    repoDir = path.join(root, 'repo');
    fs.mkdirSync(repoDir);
    await git(['init'], repoDir);
    await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], repoDir);
    await git(['config', 'user.email', 'test@test.com'], repoDir);
    await git(['config', 'user.name', 'Test'], repoDir);
    fs.writeFileSync(path.join(repoDir, '.gitignore'), '.env*\n');
    fs.writeFileSync(
      path.join(repoDir, '.chord.json'),
      JSON.stringify({
        shellSetup: 'source .envrc',
        scripts: { run: 'pnpm dev', teardown: 'make down' },
      })
    );
    await git(['add', '.'], repoDir);
    await git(['commit', '-m', 'init'], repoDir);
    // The main checkout's files to copy.
    fs.writeFileSync(path.join(repoDir, '.env'), 'FROM=main\n');
    fs.writeFileSync(path.join(repoDir, '.env.local'), 'LOCAL=main\n');

    adoptedPath = path.join(root, 'repo', '.claude', 'worktrees', 'x');
    await git(['worktree', 'add', '-b', 'claude/x', adoptedPath, 'main'], repoDir);
    fs.writeFileSync(path.join(adoptedPath, '.env'), 'FROM=worktree\n');
    chordPath = path.join(root, 'pool', 'item');
    await git(['worktree', 'add', '-b', 'chord/item', chordPath, 'main'], repoDir);

    db.insert(repos).values({ id: REPO_ID, path: repoDir, alias: 'repo' }).run();
    db.insert(workItems)
      .values({
        id: ITEM_ID,
        name: 'item',
        repoId: REPO_ID,
        repoPath: adoptedPath,
        provisionStatus: 'ready',
      })
      .run();
    insertLane(ADOPTED, adoptedPath, true, 'adopted');
    insertLane(CHORD, chordPath, false, 'chord');
  });

  afterEach(() => {
    db.delete(workItems).run();
    db.delete(repos).run();
    removeDirSync(root);
  });

  it("Run setup keeps the checkout's own .env, copies what is missing, and logs what it kept", async () => {
    expect(await runLaneSetup(ADOPTED, neverAsk)).toBe('ok');

    expect(fs.readFileSync(path.join(adoptedPath, '.env'), 'utf8')).toBe('FROM=worktree\n');
    expect(fs.readFileSync(path.join(adoptedPath, '.env.local'), 'utf8')).toBe('LOCAL=main\n');
    const log = await readLaneSetupLog(ADOPTED);
    const kept = log.split('\n').filter((line) => /already/i.test(line));
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatch(/\.env\b/);
    expect(kept[0]).not.toContain('.env.local');
    expect(log).toContain('Copied .env.local');
    // An adopted lane's setup was never declined: the Don't run note is not its story.
    expect(log).not.toMatch(/Don't run/);
  });

  it('runs no teardown, even one the user approved for the lane', async () => {
    const { bundle } = await resolveLaneBundle(ADOPTED);
    if (!bundle) throw new Error('nothing to approve');
    recordLaneApproval(ADOPTED, bundle);

    expect(await resolveApprovedLaneScripts(ADOPTED)).toEqual({
      shellSetup: 'source .envrc',
      run: { default: 'pnpm dev' },
    });
  });

  it("runs no teardown, not even the user's own just-me one", async () => {
    db.insert(repoSettings)
      .values({
        repoId: REPO_ID,
        overrides: JSON.stringify({ scripts: { teardown: 'make my-down', run: 'make run' } }),
      })
      .run();

    expect(await resolveApprovedLaneScripts(ADOPTED)).toEqual({ run: { default: 'make run' } });
  });

  it('keeps the approved teardown of a lane Chord made', async () => {
    const { bundle } = await resolveLaneBundle(CHORD);
    if (!bundle) throw new Error('nothing to approve');
    recordLaneApproval(CHORD, bundle);

    expect(await resolveApprovedLaneScripts(CHORD)).toMatchObject({ teardown: 'make down' });
  });

  it("Run setup's trust prompt on an adopted lane doesn't list the teardown it never runs", async () => {
    fs.writeFileSync(
      path.join(repoDir, '.chord.json'),
      JSON.stringify({
        shellSetup: 'source .envrc',
        scripts: { setup: 'pnpm install', run: 'pnpm dev', teardown: 'make down' },
      })
    );
    await git(['commit', '-am', 'add a setup script'], repoDir);
    const asked: ScriptApprovalRequest[] = [];
    const decline: AskScriptApproval = async (request) => {
      asked.push(request);
      return 'skip';
    };

    expect(await runLaneSetup(ADOPTED, decline)).toBe('skipped');

    expect(asked).toHaveLength(1);
    const { chord } = asked[0].bundle.content;
    expect(chord).toMatchObject({ setup: 'pnpm install', run: 'pnpm dev' });
    expect(chord).not.toHaveProperty('teardown');
    const page = renderTrustPromptPage({
      repoPath: repoDir,
      ref: 'main',
      claudeSource: null,
      bundle: asked[0].bundle.content,
      previous: null,
      shellSetupRuns: true,
      adoptedCheckout: true,
      theme: 'dark',
      tokenSheet: '',
    });
    expect(page).toContain('Setup script');
    expect(page).toContain('Runs in this checkout, now.');
    expect(page).not.toContain('Teardown script');
    expect(page).not.toContain('make down');
  });

  it("an adopted lane's Always trust doesn't cover the teardown of a lane Chord made", async () => {
    const adopted = await resolveLaneBundle(ADOPTED);
    if (!adopted.bundle) throw new Error('nothing to approve');
    recordRepoApproval({
      repoId: REPO_ID,
      hash: adopted.bundle.hash,
      content: adopted.bundle.content,
      remoteUrl: adopted.remoteUrl,
    });

    expect(await resolveApprovedLaneScripts(ADOPTED)).toEqual({
      shellSetup: 'source .envrc',
      run: { default: 'pnpm dev' },
    });
    // What was trusted never showed the teardown: the lane Chord made is asked again.
    expect(await resolveApprovedLaneScripts(CHORD)).toEqual({ run: {} });
  });

  it('Always trust given from a lane Chord made still covers an adopted lane', async () => {
    const made = await resolveLaneBundle(CHORD);
    if (!made.bundle) throw new Error('nothing to approve');
    recordRepoApproval({
      repoId: REPO_ID,
      hash: made.bundle.hash,
      content: made.bundle.content,
      remoteUrl: made.remoteUrl,
    });

    expect(await resolveApprovedLaneScripts(ADOPTED)).toEqual({
      shellSetup: 'source .envrc',
      run: { default: 'pnpm dev' },
    });
  });
});
