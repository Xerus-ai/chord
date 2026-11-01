import type { Octokit } from '@octokit/rest';
import { err, ok, type Result } from '@shared/result';
import type { IssueLookupError, WorkItemTicket } from '@shared/work-item-ticket';

/** A failed GitHub request's HTTP status, when it got one. */
export function readGitHubStatus(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
}

export function describeGitHubFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reads one issue as a ticket, in the owner/repo the pasted URL names — never
 * the selected repository. Null `octokit` means GitHub isn't connected. Each
 * failure is named (`not_connected | not_found | error`) for the create
 * dialog to show; nothing here answers with a stand-in.
 */
export async function getGitHubIssue(
  octokit: Octokit | null,
  ref: { owner: string; repo: string; number: number }
): Promise<Result<WorkItemTicket, IssueLookupError>> {
  if (!octokit) {
    return err({ type: 'not_connected', message: 'GitHub is not connected.' });
  }
  try {
    const { data } = await octokit.rest.issues.get({
      owner: ref.owner,
      repo: ref.repo,
      issue_number: ref.number,
    });
    return ok({
      provider: 'github',
      id: String(data.number),
      url: data.html_url,
      title: data.title,
    });
  } catch (error) {
    const status = readGitHubStatus(error);
    const message = describeGitHubFailure(error);
    if (status === 401) return err({ type: 'not_connected', message });
    if (status === 404) {
      return err({
        type: 'not_found',
        message: `${ref.owner}/${ref.repo}#${ref.number} was not found.`,
      });
    }
    return err({ type: 'error', message });
  }
}
