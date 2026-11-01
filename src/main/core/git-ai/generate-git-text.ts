import {
  gitAiTransport,
  type GeneratedCommitMessage,
  type GeneratedPullRequest,
  type GitAiAgent,
} from '@shared/git-ai';
import { readLanePullRequests } from '@main/core/pull-requests/lane-pull-requests';
import { loadWorkItem, resolveCheckoutPath } from '@main/core/work-items/work-item-checkout';
import { runAcpOneShot } from './acp-one-shot';
import { runClaudeOneShot } from './claude-one-shot';
import { runCodexOneShot } from './codex-one-shot';
import {
  budgetDiff,
  budgetDiffSections,
  GIT_AI_DIFF_BUDGET_CHARS,
  PENDING_SECTION_LABEL,
} from './diff-budget';
import { boundAgentOutput, GitAiError } from './git-ai-errors';
import { readCommitInput, readPullRequestInput } from './git-ai-inputs';
import { GitAiOutputError, parseCommitMessage, parsePullRequestFields } from './git-ai-output';
import { buildCommitPrompt, buildPullRequestPrompt } from './git-ai-prompts';
import { readGitAiSettings } from './git-ai-settings';
import type { OneShotRequest } from './one-shot-run';
import { readPullRequestTemplate } from './pr-template';

export interface GenerateTarget {
  workItemId: string;
  worktreeId: string;
  signal: AbortSignal;
}

function runOneShot(agent: GitAiAgent, request: OneShotRequest): Promise<string> {
  switch (gitAiTransport(agent)) {
    case 'claude-sdk':
      return runClaudeOneShot(request);
    case 'codex-app-server':
      return runCodexOneShot(request);
    case 'acp':
      return runAcpOneShot(agent, request);
  }
}

/** Parses the answer; an unusable one is a failure carrying the answer. */
function parseAnswer<T>(agent: GitAiAgent, raw: string, parse: (raw: string) => T): T {
  try {
    return parse(raw);
  } catch (error) {
    if (!(error instanceof GitAiOutputError)) throw error;
    throw new GitAiError({
      type: 'unreadable_output',
      agent,
      message: error.message,
      output: boundAgentOutput(raw),
    });
  }
}

async function resolveLane(workItemId: string, worktreeId: string) {
  const item = await loadWorkItem(workItemId);
  if (!item) throw new Error(`No work item with id ${workItemId}`);
  const checkout = resolveCheckoutPath(item, worktreeId);
  if (!checkout.success) {
    throw new Error(`Lane ${worktreeId} has no checkout here: ${JSON.stringify(checkout.error)}`);
  }
  return { item, checkout: checkout.data };
}

/** Generate in the commit field: a message for what Commit will commit. */
export async function generateCommitMessage(
  target: GenerateTarget
): Promise<GeneratedCommitMessage> {
  const { item, checkout } = await resolveLane(target.workItemId, target.worktreeId);
  const { value: settings } = await readGitAiSettings(item.repoId);
  const input = await readCommitInput(checkout);
  const diff = budgetDiff(input.diff, GIT_AI_DIFF_BUDGET_CHARS);
  const raw = await runOneShot(settings.agent, {
    prompt: buildCommitPrompt({
      branch: input.branch,
      diff,
      instructions: settings.instructions.commit,
    }),
    model: settings.model,
    signal: target.signal,
  });
  return {
    message: parseAnswer(settings.agent, raw, parseCommitMessage),
    agent: settings.agent,
    inputCut: diff.cut,
  };
}

/** Generate in Create PR: title and body for what Create PR will open. */
export async function generatePullRequestText(
  target: GenerateTarget
): Promise<GeneratedPullRequest> {
  const { item, checkout } = await resolveLane(target.workItemId, target.worktreeId);
  const lanes = await readLanePullRequests(target.workItemId);
  const lane = lanes?.lanes.find((row) => row.worktreeId === target.worktreeId);
  if (!lane) throw new Error(`Worktree ${target.worktreeId} is not a live lane of ${item.id}`);
  if (lane.targetRef === null || lane.prBase === null) {
    throw new GitAiError({
      type: 'nothing_to_describe',
      message: `This branch has no target to describe it against: ${lane.targetError}`,
    });
  }
  const { value: settings } = await readGitAiSettings(item.repoId);
  const input = await readPullRequestInput(checkout, lane.targetRef);
  const template = settings.prDefaults.useTemplate ? await readPullRequestTemplate(checkout) : null;
  const diff = budgetDiffSections(
    [
      { label: null, diff: input.diff },
      { label: PENDING_SECTION_LABEL, diff: input.pendingDiff },
    ],
    GIT_AI_DIFF_BUDGET_CHARS
  );
  const raw = await runOneShot(settings.agent, {
    prompt: buildPullRequestPrompt({
      branch: input.branch,
      base: lane.prBase,
      commits: input.commits,
      diff,
      template: template?.text ?? null,
      instructions: settings.instructions.pr,
    }),
    model: settings.model,
    signal: target.signal,
  });
  return {
    ...parseAnswer(settings.agent, raw, parsePullRequestFields),
    agent: settings.agent,
    inputCut: diff.cut,
  };
}
