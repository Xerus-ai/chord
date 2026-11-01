import { getAgentDisplayName } from '@shared/agent-display-name';
import { GIT_AI_AGENTS, type GitAiAgent } from '@shared/git-ai';
import { createRPCController } from '@shared/ipc/rpc';
import { err, ok } from '@shared/result';
import { readJustMeSettings } from '@main/core/repo-config/resolve-repo-config';
import { loadWorkItem, resolveCheckoutPath } from '@main/core/work-items/work-item-checkout';
import { generateCommitMessage, generatePullRequestText } from './generate-git-text';
import { readGitAiAgentStatus } from './git-ai-agent-status';
import { GitAiError } from './git-ai-errors';
import { readGitAiSettings } from './git-ai-settings';
import { readPullRequestTemplate } from './pr-template';

/** Runs in flight, by the renderer's request id, so Cancel can reach them. */
const running = new Map<string, AbortController>();

async function runCancellable<T>(requestId: string, work: (signal: AbortSignal) => Promise<T>) {
  if (running.has(requestId)) throw new Error(`Git AI request ${requestId} is already running`);
  const controller = new AbortController();
  running.set(requestId, controller);
  try {
    return ok(await work(controller.signal));
  } catch (error) {
    // A typed failure is the user's to read; anything else is a bug and throws.
    if (error instanceof GitAiError) return err(error.failure);
    throw error;
  } finally {
    running.delete(requestId);
  }
}

/**
 * Settings › Git › AI and "Generate" (plan §Phase 3 slice 4). A Generate
 * returns the text for the field or the reason it has none; the field is the
 * renderer's, and is only ever written on success.
 */
export const gitAiController = createRPCController({
  /** Per field: built-in < You < the repository's just-me override. */
  getSettings: async (args: { repoId: string | null }) => ok(await readGitAiSettings(args.repoId)),

  /** The repository page: what applies here, and which fields this repo sets itself. */
  getRepoSettings: async (repoId: string) =>
    ok({
      resolved: await readGitAiSettings(repoId),
      override: readJustMeSettings(repoId).gitAi ?? {},
    }),

  /** Every agent that can run a one-shot prompt, by name. */
  listAgents: async () =>
    ok(GIT_AI_AGENTS.map((agent) => ({ agent, name: getAgentDisplayName(agent) }))),

  getAgentStatus: async (args: { agent: GitAiAgent }) => {
    try {
      return ok(await readGitAiAgentStatus(args.agent));
    } catch (error) {
      return err({
        type: 'check_failed' as const,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  },

  generateCommitMessage: (args: { workItemId: string; worktreeId: string; requestId: string }) =>
    runCancellable(args.requestId, (signal) => generateCommitMessage({ ...args, signal })),

  generatePullRequest: (args: { workItemId: string; worktreeId: string; requestId: string }) =>
    runCancellable(args.requestId, (signal) => generatePullRequestText({ ...args, signal })),

  /** Cancels a run; the field keeps what it had. False when the run already ended. */
  cancel: async (args: { requestId: string }) => {
    const controller = running.get(args.requestId);
    controller?.abort();
    return ok({ canceled: controller !== undefined });
  },

  /** What Create PR opens with: the agent and PR defaults here, and the lane's template. */
  getPullRequestDefaults: async (args: { workItemId: string; worktreeId: string }) => {
    const item = await loadWorkItem(args.workItemId);
    if (!item) return err({ type: 'not_found' as const });
    const checkout = resolveCheckoutPath(item, args.worktreeId);
    if (!checkout.success) return err(checkout.error);
    const { value } = await readGitAiSettings(item.repoId);
    return ok({
      agent: value.agent,
      prDefaults: value.prDefaults,
      template: await readPullRequestTemplate(checkout.data),
    });
  },
});
