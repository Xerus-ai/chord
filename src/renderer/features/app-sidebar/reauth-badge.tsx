import { Loader2 } from 'lucide-react';
import { useAccountSignIn, useAuthState } from '@renderer/lib/hooks/useAccount';

/**
 * The expired-session call-to-action, as a compact chip inside the footer
 * row (the prototype's `.warn-chip`) rather than a ~140px callout block. The
 * full explanation moves to the `title` tooltip; the click performs the same
 * sign-in action the old callout's button did.
 */
export function ReauthBadge() {
  const authState = useAuthState();
  const signIn = useAccountSignIn();

  if (authState !== 'reauth_required') return null;

  return (
    <button
      type="button"
      onClick={() => signIn.mutate()}
      disabled={signIn.isPending}
      title="Session expired. Sign in again to sync your work items."
      className="flex h-[22px] shrink-0 cursor-pointer items-center gap-1 rounded-md bg-status-warn/15 px-2 text-tiny tracking-tiny font-medium text-status-warn transition-colors disabled:bg-action-bg-disabled disabled:text-action-fg-disabled"
    >
      {signIn.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
      Sign in to sync
    </button>
  );
}
