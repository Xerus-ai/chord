import type {
  AskScriptApproval,
  ScriptApprovalRequest,
} from '@main/core/workspaces/ask-script-approval';
import type { ExecutableBundle } from '@main/core/workspaces/executable-bundle';
import { isBundleApproved } from '@main/core/workspaces/script-approval';

/**
 * The one step before anything a repository supplies runs in a lane — its
 * setup, its shellSetup at agent start, its teardown at removal: true when
 * there is nothing to approve or it is approved (asking when it is not),
 * false after Don't run.
 */

type ApprovalQuestion = Omit<ScriptApprovalRequest, 'bundle' | 'repoId'> & {
  repoId: string | null;
  bundle: ExecutableBundle | null;
};

/** Callers waiting on the same content share one dialog. */
const openAsks = new Map<string, Promise<'run' | 'skip'>>();

/**
 * Lane + content the user chose Don't run for, in this run of the app. An
 * agent (re)start — a model change respawns one — does not ask again about
 * it; setup does, because Run setup is the user asking to run it.
 */
const declined = new Set<string>();

export interface ApprovalOptions {
  /** After Don't run for this content: ask again (setup, teardown), or not (agent starts). */
  afterDecline?: 'ask' | 'skip';
}

export async function approveBundleForLane(
  question: ApprovalQuestion,
  ask: AskScriptApproval,
  options: ApprovalOptions = {}
): Promise<boolean> {
  const { bundle, repoId } = question;
  if (!bundle) return true;
  if (repoId === null) {
    throw new Error(`Lane ${question.laneId} has no repository, so its scripts cannot be approved`);
  }
  const approved = () =>
    isBundleApproved({
      laneId: question.laneId,
      repoId,
      bundle,
      remoteUrl: question.remoteUrl,
    });
  if (approved()) return true;

  const key = `${repoId}\0${question.laneId}\0${bundle.hash}`;
  if (options.afterDecline === 'skip' && declined.has(key)) return false;
  let open = openAsks.get(key);
  if (!open) {
    open = ask({ ...question, repoId, bundle }).finally(() => openAsks.delete(key));
    openAsks.set(key, open);
  }
  const answer = await open;
  // What counts is the recorded approval, not the answer alone.
  const runs = answer === 'run' && approved();
  if (runs) declined.delete(key);
  else declined.add(key);
  return runs;
}
