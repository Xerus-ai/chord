/**
 * One-line, user-facing text for a git action that did not go through, so a
 * failed Apply/Undo/Revert/Commit shows why instead of a spinner that stops.
 * `action` is the button's own wording ("Undo All", "Commit and push").
 */

import { toast } from '@renderer/lib/hooks/use-toast';

type ActionError = { readonly type: string; readonly message?: string };

/** For an `err(...)` an RPC handler returned. */
export function describeRpcFailure(action: string, error: ActionError): string {
  return `${action} failed: ${error.message ?? error.type}`;
}

/** For a rejection thrown out of the RPC call itself (IPC transport). */
export function describeThrownFailure(action: string, error: unknown): string {
  return `${action} failed: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Same failure, reported as a toast instead of inline text.
 *
 * For the steps that run *after* the thing they belong to already exists — a
 * created work item whose ticket link or first message did not go through. The
 * surface that raised those closes or navigates on success, so an inline
 * message would be set onto a component that is about to unmount and never be
 * read.
 *
 * Takes a bare string too: not every controller returns the structured error
 * shape (`rpc.workItemTickets.addTicket` rejects with a plain message).
 */
export function toastRpcFailure(action: string, error: ActionError | string): void {
  toast({
    title: `${action} failed`,
    description: typeof error === 'string' ? error : (error.message ?? error.type),
    variant: 'destructive',
  });
}
