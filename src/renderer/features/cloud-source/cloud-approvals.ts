import type { PermissionOptionData } from '@renderer/features/work-list/chat-types';

/** The answer a `permission_response` command carries; the owner's device maps it back. */
export type PermissionResponseKind = 'allow_once' | 'allow_always' | 'reject_once';

/**
 * A teammate answers with the option's KIND, not its id: the owner's device
 * maps the kind back to the agent's real option. Either reject is sent as the
 * one-time reject, the only one the wire carries.
 */
export function permissionResponseKind(
  option: PermissionOptionData
): PermissionResponseKind | null {
  if (option.kind === 'allow_once' || option.kind === 'allow_always') return option.kind;
  if (option.kind === 'reject_once' || option.kind === 'reject_always') return 'reject_once';
  return null;
}

/**
 * The agent's pending requests one chat shows (step 4, decision 5): its own
 * session's, and a request from no session in the focused chat only, so it is
 * answered in one place. The item chat (`sessionId` null) is the whole item:
 * every pending request.
 */
export function selectThreadRequests<R extends { session_id: string | null; status: string }>(
  requests: readonly R[],
  { sessionId, focused }: { sessionId: string | null; focused: boolean }
): R[] {
  return requests.filter(
    (request) =>
      request.status === 'pending' &&
      (sessionId === null ||
        request.session_id === sessionId ||
        (request.session_id === null && focused))
  );
}
