import { existsSync } from 'node:fs';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { laneSetupChangedChannel, type LaneSetupStatus } from '@shared/events/workItemEvents';
import { copyFilesToCheckout } from '@main/core/projects/worktrees/copy-files-to-checkout';
import type { AskScriptApproval } from '@main/core/workspaces/ask-script-approval';
import { db } from '@main/db/client';
import { workItemWorktrees, type WorkItemWorktreeRow } from '@main/db/schema-work-items';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { resolveLaneBundle } from './lane-bundle';
import { buildLaneEnv } from './lane-env';
import { notifyLaneChanged } from './lane-readiness';
import { approveBundleForLane } from './lane-run-approval';
import { laneSetupLogPath, runSetupScript } from './run-setup-script';
import { findWorktreeRow } from './worktree-lookup';

/**
 * Setup for a lane's checkout, as state: `setup_status` moves pending →
 * running → ok | failed | skipped, the whole run is logged, and a failure
 * keeps the checkout so the user can read the log and Retry.
 *
 * Everything config-driven about a new checkout happens here, reading
 * `.chord.json` at the lane's TARGET REF (never the checkout's own copy):
 *   1. resolve the config — an invalid file fails setup with the parse error;
 *   2. copy the files to copy (gitignored only, capped);
 *   3. run `scripts.setup`, only if the user approved exactly what the lane
 *      would run — asking them when they have not. Don't run skips it. A
 *      just-me setup script is the user's own and runs without asking.
 */

export type LaneSetupOutcome = 'ok' | 'failed' | 'skipped';

const inFlight = new Map<string, Promise<LaneSetupOutcome>>();

class SetupFailure extends Error {}

function setStatus(row: WorkItemWorktreeRow, status: LaneSetupStatus, logPath?: string): void {
  db.update(workItemWorktrees)
    .set(logPath ? { setupStatus: status, setupLogPath: logPath } : { setupStatus: status })
    .where(eq(workItemWorktrees.id, row.id))
    .run();
  events.emit(laneSetupChangedChannel, {
    worktreeId: row.id,
    workItemId: row.workItemId,
    status,
  });
  notifyLaneChanged(row.id);
}

async function runOnce(laneId: string, ask: AskScriptApproval): Promise<LaneSetupOutcome> {
  const row = findWorktreeRow(laneId);
  if (!row) throw new Error(`Lane ${laneId} does not exist`);

  let logPath: string | null = null;
  const note = async (line: string) => {
    if (logPath) await appendFile(logPath, `[chord] ${line}\n`);
  };

  try {
    logPath = await laneSetupLogPath(row.path);
    await writeFile(logPath, `[chord] Setup started ${new Date().toISOString()}\n`);
    setStatus(row, 'running', logPath);

    const lane = await resolveLaneBundle(laneId);
    const { config, sourcePath, targetRef } = lane;
    await note(`Using .chord.json at ${targetRef}${config.oid ? ` (${config.oid})` : ' (none)'}`);

    const copy = await copyFilesToCheckout({
      repoPath: sourcePath,
      checkoutPath: row.path,
      patterns: config.filesToCopy.value,
      // An adopted checkout is the user's: a file it already has stays theirs.
      keepExisting: row.checkoutOrigin === 'adopted',
    });
    if (!copy.success) throw new SetupFailure(copy.error.message);
    const { copied, kept } = copy.data;
    if (kept.length > 0) await note(`Kept ${kept.join(', ')} (already in the checkout)`);
    if (copied.length > 0) await note(`Copied ${copied.join(', ')}`);
    if (copied.length === 0 && kept.length === 0) await note('No files to copy matched');

    const setup = config.scripts.setup;
    const script = setup.value?.trim();
    if (!script) {
      await note('No setup script');
      setStatus(row, 'ok');
      return 'ok';
    }
    if (setup.layer === 'justMe') {
      // The user's own script (Repo › Run & test): nobody else wrote it.
      await note('Running your own setup script (Just me)');
    } else {
      if (lane.repoId === null) {
        throw new SetupFailure('The setup script was not run: this work item has no repository.');
      }
      await note('Checking that you approved what this lane runs');
      const approved = await approveBundleForLane(
        {
          laneId,
          repoId: lane.repoId,
          repoPath: sourcePath,
          ref: targetRef,
          remoteUrl: lane.remoteUrl,
          bundle: lane.bundle,
        },
        ask
      );
      if (!approved) {
        await note(
          "The setup script was not run: you chose Don't run. Use Run setup to review it again."
        );
        setStatus(row, 'skipped');
        return 'skipped';
      }
    }

    const env = await buildLaneEnv(laneId);
    await note(`$ ${script}`);
    const { exitCode, signal } = await runSetupScript({ cwd: row.path, script, env, logPath });
    if (exitCode !== 0) {
      throw new SetupFailure(
        signal ? `Setup was killed by ${signal}` : `Setup exited with code ${exitCode}`
      );
    }
    await note('Setup finished');
    setStatus(row, 'ok');
    return 'ok';
  } catch (error) {
    // The failure is the lane's recorded state, with the reason in its log —
    // what the provisioning bar shows next to Retry. With no log (the
    // checkout's git dir could not be read, or is gone because the lane was
    // archived or deleted while setup ran) the reason is in the app log.
    const message = error instanceof Error ? error.message : String(error);
    if (logPath && existsSync(path.dirname(logPath))) await note(message);
    log.warn('[lanes] setup failed', { laneId, logPath, error: message });
    setStatus(row, 'failed');
    return 'failed';
  }
}

/**
 * Runs (or re-runs, for Retry / Run setup) a lane's setup. One run per lane at
 * a time. Never rejects: every failure becomes the lane's `failed` state.
 *
 * A setup script the user has not approved is put to them through `ask` (in
 * the app: `askScriptApproval`) when the run reaches it.
 */
export function runLaneSetup(laneId: string, ask: AskScriptApproval): Promise<LaneSetupOutcome> {
  const current = inFlight.get(laneId);
  if (current) return current;
  const run = runOnce(laneId, ask).finally(() => inFlight.delete(laneId));
  inFlight.set(laneId, run);
  return run;
}

export async function readLaneSetupLog(laneId: string): Promise<string> {
  const row = findWorktreeRow(laneId);
  if (!row) throw new Error(`Lane ${laneId} does not exist`);
  if (!row.setupLogPath) return '';
  return readFile(row.setupLogPath, 'utf8');
}
