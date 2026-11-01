import type { GitAiSettings, PullRequestTemplate } from '@shared/git-ai';
import type { LanePullRequest } from '@shared/lane-pull-requests';

export interface CreatePrFormValues {
  /** The lane's branch: what the PR is opened from. */
  head: string | null;
  /** The lane's target without the remote: what the PR merges into. */
  base: string | null;
  title: string;
  body: string;
  draft: boolean;
  /** Open the new PR in the browser once it is created. */
  openAfterCreate: boolean;
}

/**
 * What the Create PR form opens with for a lane: the work item's name as the
 * title, and Settings › Git › AI's PR defaults — the repository's template as
 * the body when Use template is on (Generate replaces it), the draft box, and
 * whether the PR opens in the browser afterwards.
 */
export function prefillCreatePrForm(args: {
  workItemName: string;
  lane: LanePullRequest;
  prDefaults: GitAiSettings['prDefaults'];
  template: PullRequestTemplate | null;
}): CreatePrFormValues {
  return {
    head: args.lane.branchName,
    base: args.lane.prBase,
    title: args.workItemName,
    body: args.prDefaults.useTemplate && args.template ? args.template.text : '',
    draft: args.prDefaults.draft,
    openAfterCreate: args.prDefaults.openAfterCreate,
  };
}
