import type { LinearClient } from '@linear/sdk';
import { err, ok, type Result } from '@shared/result';
import type { IssueLookupError, WorkItemTicket } from '@shared/work-item-ticket';

/**
 * By team key and number rather than `issue(id:)`: an empty `nodes` is then
 * an unambiguous "not found", with no reading of Linear's error payloads.
 */
const ISSUE_BY_KEY_QUERY = `
  query IssueByKey($teamKey: String!, $number: Float!) {
    issues(first: 1, filter: { team: { key: { eq: $teamKey } }, number: { eq: $number } }) {
      nodes { identifier title url }
    }
  }
`;

interface IssueByKeyData {
  issues: { nodes: Array<{ identifier: string; title: string; url: string }> };
}

const ISSUE_KEY = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/;

/** Reads one Linear issue by its key (`ENG-42`) as a ticket. Null `client` means not connected. */
export async function getLinearIssue(
  client: LinearClient | null,
  key: string
): Promise<Result<WorkItemTicket, IssueLookupError>> {
  if (!client) {
    return err({ type: 'not_connected', message: 'Linear is not connected.' });
  }
  const parsed = ISSUE_KEY.exec(key.trim());
  if (!parsed) return err({ type: 'not_found', message: `${key} is not a Linear issue key.` });
  const teamKey = parsed[1].toUpperCase();
  const number = Number(parsed[2]);

  try {
    const { data } = await client.client.rawRequest<
      IssueByKeyData,
      { teamKey: string; number: number }
    >(ISSUE_BY_KEY_QUERY, { teamKey, number });
    const issue = data?.issues.nodes[0];
    if (!issue) return err({ type: 'not_found', message: `${teamKey}-${number} was not found.` });
    return ok({ provider: 'linear', id: issue.identifier, url: issue.url, title: issue.title });
  } catch (error) {
    return err({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
