import type { CreateWorkItemArgs } from '@shared/create-work-item';
import { err, ok, type Result } from '@shared/result';
import { TICKET_PROVIDERS } from '@shared/work-item-ticket';

export type InvalidCreateRequest = { type: 'invalid_request'; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalid(message: string): Result<never, InvalidCreateRequest> {
  return err({ type: 'invalid_request', message });
}

/**
 * The shape checks on a create request, before anything is read or written.
 * The payload crosses IPC, so the types are a claim the wire can break.
 */
export function validateCreateWorkItemRequest(
  args: CreateWorkItemArgs
): Result<void, InvalidCreateRequest> {
  if (args.id !== undefined && !UUID.test(args.id)) {
    return invalid('A work item id must be a UUID');
  }
  const existingBranch = args.existingBranch?.trim();
  if (existingBranch && args.baseRef) {
    return invalid('Choose either an existing branch or a base branch, not both');
  }
  if (args.pullRequest) {
    const { number, headRef, baseRemote } = args.pullRequest;
    if (!existingBranch) return invalid('A pull request needs the branch to check it out into');
    if (!Number.isInteger(number) || number <= 0) {
      return invalid('A pull request number must be a positive integer');
    }
    if (!headRef?.trim() || headRef.startsWith('-')) {
      return invalid(`Invalid pull request head branch: "${headRef}"`);
    }
    if (typeof baseRemote !== 'string') {
      return invalid('A pull request needs the remote that is its repository to fetch it from');
    }
    if (!baseRemote.trim() || baseRemote.startsWith('-')) {
      return invalid(`Invalid pull request remote: "${baseRemote}"`);
    }
  }
  if (args.trackRemoteBranch) {
    const { remote, branch } = args.trackRemoteBranch;
    if (!existingBranch)
      return invalid('A remote branch needs the local branch to check it out as');
    if (args.pullRequest)
      return invalid('Choose either a remote branch or a pull request, not both');
    if (!remote?.trim() || remote.startsWith('-')) return invalid(`Invalid remote: "${remote}"`);
    if (!branch?.trim() || branch.startsWith('-')) return invalid(`Invalid branch: "${branch}"`);
  }
  if (args.ticket) {
    if (!TICKET_PROVIDERS.includes(args.ticket.provider)) {
      return invalid(`Unknown ticket provider: ${String(args.ticket.provider)}`);
    }
    if (!args.ticket.id?.trim()) return invalid('A ticket needs an id');
  }
  return ok();
}
