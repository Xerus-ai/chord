import { Settings } from 'lucide-react';
import { useAccountSession } from '@renderer/lib/hooks/useAccount';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { ReauthBadge } from './reauth-badge';
import { SyncHealthBadge } from './sync-health-badge';

interface Identity {
  initial: string;
  label: string;
  /** Null when the profile has no picture — the account service stores ''. */
  avatarUrl: string | null;
  degraded: boolean;
}

/**
 * The footer never invents an identity. A failed session read and a session
 * still in flight are distinct states, and neither is rendered as a signed-in
 * user named "User".
 */
function resolveIdentity(
  session:
    | { user: { username: string | null; email: string | null; avatarUrl: string } | null }
    | undefined,
  isError: boolean,
  isPending: boolean
): Identity {
  if (isError)
    return { initial: '!', label: 'Account unavailable', avatarUrl: null, degraded: true };
  if (isPending || !session)
    return { initial: '·', label: 'Reading account…', avatarUrl: null, degraded: true };

  const avatarUrl = session.user?.avatarUrl || null;

  const name = session.user?.username?.split(' ')[0] ?? null;
  if (name)
    return { initial: name.charAt(0).toUpperCase(), label: name, avatarUrl, degraded: false };

  const email = session.user?.email ?? null;
  if (email)
    return { initial: email.charAt(0).toUpperCase(), label: email, avatarUrl, degraded: false };

  return { initial: '·', label: 'No profile on this account', avatarUrl: null, degraded: true };
}

export function SidebarFooter() {
  const { navigate } = useNavigate();
  const { data: session, isError, isPending, refetch } = useAccountSession();
  const identity = resolveIdentity(session, isError, isPending);

  const reauthRequired = session?.authState === 'reauth_required';

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-t border-border px-2">
      <div className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-hover-solid text-micro tracking-micro font-bold text-text-muted">
        {identity.avatarUrl ? (
          <img
            src={identity.avatarUrl}
            alt={identity.label}
            className="size-6 rounded-full object-cover"
          />
        ) : (
          identity.initial
        )}
        {/* Expired-session dot: visible even when the chip has scrolled out
            of a short sidebar. */}
        {reauthRequired && (
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-status-warn ring-2 ring-surface" />
        )}
      </div>
      <span
        className={
          identity.degraded
            ? 'min-w-0 flex-1 truncate text-list-row text-text-passive'
            : 'min-w-0 flex-1 truncate text-list-row text-text-muted'
        }
      >
        {identity.label}
      </span>
      <SyncHealthBadge />
      <ReauthBadge />
      {isError && (
        <button
          onClick={() => void refetch()}
          className="shrink-0 cursor-pointer rounded-xs px-1.5 py-0.5 text-tiny tracking-tiny font-semibold text-status-err transition-colors hover:bg-surface-inset"
          title="Retry reading your account"
        >
          Retry
        </button>
      )}
      <button
        onClick={() => navigate('settings')}
        className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-passive transition-colors hover:bg-surface-inset hover:text-text-passive"
        title="Settings"
      >
        <Settings className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
