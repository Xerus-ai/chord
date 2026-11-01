import { isAdoptedLane } from '@main/core/worktrees/lane-config';
import type { ExecutableBundle } from './executable-bundle';
import {
  readAlwaysTrustedContent,
  recordLaneApproval,
  recordRepoApproval,
} from './script-approval';

/** A lane is about to run `bundle`, which the user has not approved. */
export interface ScriptApprovalRequest {
  laneId: string;
  repoId: string;
  repoPath: string;
  ref: string;
  remoteUrl: string | null;
  bundle: ExecutableBundle;
}

/**
 * Asks the user and records what they approved before resolving: 'run' once
 * approved (for the lane, or for the repository with Always trust), 'skip'
 * for Don't run or a dismissed window, which records nothing.
 */
export type AskScriptApproval = (request: ScriptApprovalRequest) => Promise<'run' | 'skip'>;

/** The app's asker: main's own window (`trust-prompt-window.ts`), never the renderer. */
export const askScriptApproval: AskScriptApproval = async (request) => {
  // Loaded here, not at the top: the window module needs Electron's main
  // process, and this module is imported by code that runs without it.
  const { showTrustPromptWindow } = await import('./trust-prompt-window');
  const answer = await showTrustPromptWindow({
    repoPath: request.repoPath,
    ref: request.ref,
    bundle: request.bundle.content,
    previous: readAlwaysTrustedContent(request.repoId),
    shellSetupRuns: process.platform !== 'win32',
    adoptedCheckout: isAdoptedLane(request.laneId),
  });
  if (answer === 'run') {
    recordLaneApproval(request.laneId, request.bundle);
    return 'run';
  }
  if (answer === 'run-always') {
    recordRepoApproval({
      repoId: request.repoId,
      hash: request.bundle.hash,
      content: request.bundle.content,
      remoteUrl: request.remoteUrl,
    });
    return 'run';
  }
  return 'skip';
};
