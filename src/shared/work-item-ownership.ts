/**
 * Which account a local work item belongs to, for sync (devstation-as2).
 * `work_items.owner_account_id` is the creating account's user id; NULL for
 * rows from before the column (attributed by the first reconcile); or this
 * marker once the server answered that the id belongs to a different creator.
 * Sync acts only for rows the signed-in account owns — an item of another
 * account is neither sent, nor a failure, nor retried; the sidebar says so.
 */
export const OWNED_BY_ANOTHER_ACCOUNT = 'another-account';

/**
 * True for a row attributed to an account other than `currentUserId`. NULL is
 * unattributed, not foreign. With no signed-in user known (null) only the
 * server's marker counts — a row attributed to a real account cannot be told
 * apart from the caller's own until the profile is read.
 */
export function isOwnedByAnotherAccount(
  ownerAccountId: string | null,
  currentUserId: string | null
): boolean {
  if (ownerAccountId === null) return false;
  if (ownerAccountId === OWNED_BY_ANOTHER_ACCOUNT) return true;
  return currentUserId !== null && ownerAccountId !== currentUserId;
}
