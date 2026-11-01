import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import type { AskScriptApproval } from '@main/core/workspaces/ask-script-approval';
import { recordLaneApproval } from '@main/core/workspaces/script-approval';
import { db } from '@main/db/client';
import { repos, workItems, workItemWorktrees } from '@main/db/schema-work-items';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { resolveAgentStartApproval } from './lane-agent-start';

vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: cwd }).exec(GIT_EXECUTABLE, args);
  return stdout.trim();
}

const LANE = 'lane-1';
const MCP = { mcpServers: { db: { command: 'node' } } };

function answering(answer: 'run' | 'skip'): { ask: AskScriptApproval; calls: () => number } {
  let calls = 0;
  const ask: AskScriptApproval = async (request) => {
    calls += 1;
    if (answer === 'run') recordLaneApproval(request.laneId, request.bundle);
    return answer;
  };
  return { ask, calls: () => calls };
}

/**
 * When an agent starts in a lane: ask about what that start would run
 * (the repository's Claude config for a Claude session, shellSetup for a
 * terminal) only if it is unapproved, and report what may load.
 */
describe('resolveAgentStartApproval', () => {
  let root: string;
  let repoDir: string;
  let lanePath: string;

  async function commit(files: Record<string, string>): Promise<void> {
    for (const [file, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(repoDir, file), content);
      await git(['add', file], repoDir);
    }
    await git(['commit', '-m', 'files'], repoDir);
  }

  async function createLane(): Promise<void> {
    lanePath = path.join(root, 'pool', 'lane');
    await git(['worktree', 'add', '-b', 'chord/lane', lanePath, 'main'], repoDir);
    db.insert(workItemWorktrees)
      .values({
        id: LANE,
        workItemId: 'item-1',
        path: lanePath,
        isPrimary: 1,
        targetRef: 'main',
        setupStatus: 'ok',
      })
      .run();
  }

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-start-'));
    repoDir = path.join(root, 'repo');
    fs.mkdirSync(repoDir);
    await git(['init'], repoDir);
    await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], repoDir);
    await git(['config', 'user.email', 'test@test.com'], repoDir);
    await git(['config', 'user.name', 'Test'], repoDir);
    await commit({ 'README.md': 'hi' });
    db.insert(repos).values({ id: 'repo-1', path: repoDir, alias: 'repo' }).run();
    db.insert(workItems)
      .values({
        id: 'item-1',
        name: 'item',
        repoId: 'repo-1',
        repoPath: repoDir,
        provisionStatus: 'ready',
      })
      .run();
  });

  afterEach(() => {
    db.delete(workItems).run();
    db.delete(repos).run();
    removeDirSync(root);
  });

  it('loads everything without asking when the repository supplies nothing that runs', async () => {
    await createLane();
    const { ask, calls } = answering('skip');

    await expect(
      resolveAgentStartApproval(LANE, { claudeSession: true, shell: false, platform: 'linux' }, ask)
    ).resolves.toEqual({ approved: true, claude: {}, shellSetup: undefined });
    expect(calls()).toBe(0);
  });

  it("asks a Claude session about the repository's Claude config, and loads it after Run", async () => {
    await commit({ '.mcp.json': JSON.stringify(MCP) });
    await createLane();
    const { ask, calls } = answering('run');

    const result = await resolveAgentStartApproval(
      LANE,
      { claudeSession: true, shell: false, platform: 'linux' },
      ask
    );

    expect(calls()).toBe(1);
    expect(result).toEqual({ approved: true, claude: MCP, shellSetup: undefined });
  });

  it("reports it unapproved after Don't run, so the session strips it", async () => {
    await commit({ '.mcp.json': JSON.stringify(MCP) });
    await createLane();

    await expect(
      resolveAgentStartApproval(
        LANE,
        { claudeSession: true, shell: false, platform: 'linux' },
        answering('skip').ask
      )
    ).resolves.toEqual({ approved: false, claude: MCP, shellSetup: undefined });
  });

  it("does not ask again on a restart after Don't run — the session starts stripped", async () => {
    await commit({ '.mcp.json': JSON.stringify({ mcpServers: { other: { command: 'node' } } }) });
    await createLane();
    const start = { claudeSession: true, shell: false, platform: 'linux' as const };

    await resolveAgentStartApproval(LANE, start, answering('skip').ask);
    const restart = answering('run');
    await expect(resolveAgentStartApproval(LANE, start, restart.ask)).resolves.toMatchObject({
      approved: false,
    });
    expect(restart.calls()).toBe(0);
  });

  it('does not ask a non-Claude chat about Claude config it will never load', async () => {
    await commit({ '.mcp.json': JSON.stringify(MCP) });
    await createLane();
    const { ask, calls } = answering('run');

    await resolveAgentStartApproval(
      LANE,
      { claudeSession: false, shell: false, platform: 'linux' },
      ask
    );
    expect(calls()).toBe(0);
  });

  it('asks a terminal about shellSetup, and gives it only once approved', async () => {
    await commit({ '.chord.json': JSON.stringify({ shellSetup: 'source .envrc' }) });
    await createLane();

    await expect(
      resolveAgentStartApproval(
        LANE,
        { claudeSession: false, shell: true, platform: 'linux' },
        answering('skip').ask
      )
    ).resolves.toMatchObject({ approved: false, shellSetup: undefined });
    await expect(
      resolveAgentStartApproval(
        LANE,
        { claudeSession: false, shell: true, platform: 'linux' },
        answering('run').ask
      )
    ).resolves.toMatchObject({ approved: true, shellSetup: 'source .envrc' });
  });

  it('does not ask about shellSetup on Windows, where it is not run', async () => {
    await commit({ '.chord.json': JSON.stringify({ shellSetup: 'source .envrc' }) });
    await createLane();
    const { ask, calls } = answering('run');

    await resolveAgentStartApproval(
      LANE,
      { claudeSession: false, shell: true, platform: 'win32' },
      ask
    );
    expect(calls()).toBe(0);
  });

  it('does not ask at agent start about a setup script alone', async () => {
    await commit({ '.chord.json': JSON.stringify({ scripts: { setup: 'pnpm i' } }) });
    await createLane();
    const { ask, calls } = answering('run');

    await resolveAgentStartApproval(
      LANE,
      { claudeSession: true, shell: true, platform: 'linux' },
      ask
    );
    expect(calls()).toBe(0);
  });

  it('treats the Claude config as unapproved, without asking, when .chord.json is invalid', async () => {
    await commit({ '.chord.json': '{ "scripts": ', '.mcp.json': JSON.stringify(MCP) });
    await createLane();
    const { ask, calls } = answering('run');

    await expect(
      resolveAgentStartApproval(LANE, { claudeSession: true, shell: true, platform: 'linux' }, ask)
    ).resolves.toEqual({ approved: false, claude: MCP, shellSetup: undefined });
    expect(calls()).toBe(0);
  });
});
