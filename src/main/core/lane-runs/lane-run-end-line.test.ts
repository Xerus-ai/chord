import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ptyDataChannel } from '@shared/events/ptyEvents';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { db } from '@main/db/client';
import { repos, workItems } from '@main/db/schema-work-items';
import {
  addLane,
  approveLaneAsIs,
  commitTeamConfig,
  createLaneRepo,
  insertRepoAndItems,
  neverAsk,
  removeLaneRepo,
  type LaneRepo,
} from './_testing/lane-run-fixture';
import { readLaneRunState, releaseLaneRuns, stopLaneRun } from './lane-run-registry';
import { runLaneTest, startLaneRun } from './start-lane-run';

/**
 * A lane process's terminal says how it ended, in the words its row in the
 * Run tab uses (devstation-0eth): after Stop the terminal used to end
 * mid-output, and only the row said "Stopped". The line is kept in the
 * session's buffer (a terminal opened later replays it) and sent to one that
 * is open. Real processes in a real lane; only the database and the IPC
 * emitter are substituted, and what the emitter would send is captured.
 */
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const sent = vi.hoisted(() => [] as { channel: string; data: unknown; topic: unknown }[]);
vi.mock('@main/lib/events', () => ({
  events: {
    emit: (channel: { name: string }, data: unknown, topic?: unknown) =>
      sent.push({ channel: channel.name, data, topic }),
    on: () => () => {},
    once: () => () => {},
  },
}));

const ITEM_ID = 'item-1';
const LANE_ID = 'lane-1';

const TEAM_CONFIG = {
  scripts: {
    run: { web: 'node scripts/serve.cjs', env: 'node scripts/env.cjs' },
    test: 'node scripts/exit.cjs 0',
  },
};

/**
 * What a terminal opened now on the session would show: the buffer without
 * the control sequences it draws nothing for (styling, cursor and mode
 * switches, ConPTY's window title).
 */
function shownIn(sessionId: string): string {
  const buffer = ptySessionRegistry.subscribe(sessionId);
  ptySessionRegistry.unsubscribe(sessionId);
  return buffer
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

/** The last line a terminal on the session shows. */
function lastLineIn(sessionId: string): string {
  const lines = shownIn(sessionId)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');
  return lines[lines.length - 1] ?? '';
}

/** The PTY session holding a process's terminal; fails when it has none. */
function terminalOf(state: { ptySessionId: string | null } | undefined): string {
  if (!state?.ptySessionId) throw new Error('the process has no terminal session');
  return state.ptySessionId;
}

/** What was sent to a terminal that is open on the session. */
function sentTo(sessionId: string): string {
  return sent
    .filter((e) => e.channel === ptyDataChannel.name && e.topic === sessionId)
    .map((e) => String(e.data))
    .join('');
}

describe("a lane process's terminal says how it ended", () => {
  let repo: LaneRepo;

  beforeEach(async () => {
    sent.length = 0;
    repo = await createLaneRepo('lane-run-end-line-');
    await commitTeamConfig(repo.repoDir, TEAM_CONFIG);
    insertRepoAndItems(repo.repoDir, [ITEM_ID]);
    await addLane({ repo, laneId: LANE_ID, workItemId: ITEM_ID, dir: 'lane' });
    await approveLaneAsIs(LANE_ID);
  });

  afterEach(async () => {
    await releaseLaneRuns(LANE_ID);
    db.delete(workItems).run();
    db.delete(repos).run();
    await removeLaneRepo(repo);
  });

  it('ends a stopped script with "[Stopped]", kept and sent to an open terminal', async () => {
    await startLaneRun({ laneId: LANE_ID, scriptId: 'web' }, neverAsk);
    await vi.waitFor(() => expect(readLaneRunState(LANE_ID).scripts.web?.url).not.toBeNull(), {
      timeout: 15_000,
    });
    const sessionId = terminalOf(readLaneRunState(LANE_ID).scripts.web);

    await stopLaneRun(LANE_ID, 'web');

    await vi.waitFor(() => expect(lastLineIn(sessionId)).toBe('[Stopped]'), { timeout: 5_000 });
    expect(sentTo(sessionId)).toContain('[Stopped]');
  });

  it('ends a script that exits on its own with its exit code', async () => {
    await startLaneRun({ laneId: LANE_ID, scriptId: 'env' }, neverAsk);
    await vi.waitFor(() => expect(readLaneRunState(LANE_ID).scripts.env?.status).toBe('exited'), {
      timeout: 15_000,
    });
    const sessionId = terminalOf(readLaneRunState(LANE_ID).scripts.env);

    await vi.waitFor(() => expect(lastLineIn(sessionId)).toBe('[Exited 0]'), { timeout: 5_000 });
  });

  it("ends a test run with its result, as the test's row says it", async () => {
    await runLaneTest({ laneId: LANE_ID }, neverAsk);
    await vi.waitFor(() => expect(readLaneRunState(LANE_ID).test.status).toBe('passed'), {
      timeout: 15_000,
    });
    const sessionId = terminalOf(readLaneRunState(LANE_ID).test);

    await vi.waitFor(() => expect(lastLineIn(sessionId)).toBe('[Passed]'), { timeout: 5_000 });
  });
});
