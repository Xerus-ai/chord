import { LogIn, LogOut, TriangleAlert, User } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '@renderer/lib/hooks/use-toast';
import {
  useAccountHealth,
  useAccountSession,
  useAccountSignIn,
  useAccountSignOut,
} from '@renderer/lib/hooks/useAccount';
import { Button } from '@renderer/lib/ui/button';
import { ServerUnavailableMessage } from './ServerUnavailableMessage';

export function AccountTab() {
  const { data: session, isLoading } = useAccountSession();
  const { data: serverAvailable } = useAccountHealth();
  const signInMutation = useAccountSignIn();
  const signOutMutation = useAccountSignOut();
  const { toast } = useToast();

  const [error, setError] = useState<string | null>(null);

  const user = session?.user ?? null;
  const isSignedIn = session?.isSignedIn ?? false;
  const hasAccount = session?.hasAccount ?? false;
  // Credentials exist but are known dead — "Connected as" would be a lie.
  const reauthRequired = session?.authState === 'reauth_required';

  const handleSignIn = async () => {
    setError(null);
    try {
      const result = await signInMutation.mutateAsync(undefined);
      if (!result.success) {
        const message = result.error || 'Sign in failed';
        setError(message);
        toast({
          title: 'Sign in failed',
          description: message,
          variant: 'destructive',
        });
        return;
      }
      toast({
        title: 'Signed in to Chord',
        description: result.user ? `Connected as @${result.user.username}` : 'Signed in',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign in failed';
      setError(message);
      toast({
        title: 'Sign in failed',
        description: message,
        variant: 'destructive',
      });
    }
  };

  const handleSignOut = async () => {
    setError(null);
    try {
      await signOutMutation.mutateAsync();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign out failed';
      setError(message);
      toast({
        title: 'Sign out failed',
        description: message,
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-body tracking-body text-text-muted">
        Loading account...
      </div>
    );
  }

  if (isSignedIn && user) {
    return (
      <div className="flex flex-col gap-3 py-3.5">
        <div className="flex items-center gap-4">
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.username}
              className="h-12 w-12 rounded-full border border-border/60"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border/60 bg-surface-inset">
              <User className="h-6 w-6 text-text-muted" />
            </div>
          )}
          <div className="flex-1">
            {reauthRequired ? (
              <>
                <p className="flex items-center gap-1.5 text-body tracking-body font-medium text-text">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-status-warn" />
                  Session expired for <span className="font-semibold">@{user.username}</span>
                </p>
                <p className="text-tiny tracking-tiny text-text-muted">
                  Your work is safe, but sync and team features are paused until you sign in again.
                </p>
              </>
            ) : (
              <>
                <p className="text-body tracking-body font-medium text-text">
                  Connected as <span className="font-semibold">@{user.username}</span>
                </p>
                {user.email && (
                  <p className="text-tiny tracking-tiny text-text-muted">{user.email}</p>
                )}
              </>
            )}
          </div>
          {reauthRequired && (
            <Button
              type="button"
              size="sm"
              className="w-fit"
              onClick={() => void handleSignIn()}
              disabled={signInMutation.isPending}
            >
              <LogIn className="h-3.5 w-3.5" />
              {signInMutation.isPending ? 'Signing in...' : 'Sign in again'}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-fit"
            onClick={() => void handleSignOut()}
            disabled={signOutMutation.isPending}
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </Button>
        </div>
        {error && <p className="text-tiny tracking-tiny text-status-err">{error}</p>}
      </div>
    );
  }

  if (hasAccount && !isSignedIn) {
    return (
      <div className="py-3.5">
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-body tracking-body font-medium text-text">Session expired</p>
            <p className="text-tiny tracking-tiny text-text-muted">
              Sign in again to reconnect your Chord account.
            </p>
          </div>
          {error && <p className="text-tiny tracking-tiny text-status-err">{error}</p>}
          {serverAvailable === false ? (
            <ServerUnavailableMessage />
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-fit"
              onClick={() => void handleSignIn()}
              disabled={signInMutation.isPending}
            >
              <LogIn className="h-3.5 w-3.5" />
              {signInMutation.isPending ? 'Signing in...' : 'Sign In'}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="py-3.5">
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-body tracking-body font-medium text-text">Chord Account</p>
          <p className="text-tiny tracking-tiny text-text-muted">
            Create a Chord account to automatically connect GitHub using OAuth2.
          </p>
        </div>
        {error && <p className="text-tiny tracking-tiny text-status-err">{error}</p>}
        {serverAvailable === false ? (
          <ServerUnavailableMessage />
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-fit"
            onClick={() => void handleSignIn()}
            disabled={signInMutation.isPending}
          >
            <LogIn className="h-3.5 w-3.5" />
            {signInMutation.isPending ? 'Creating account...' : 'Create Account'}
          </Button>
        )}
      </div>
    </div>
  );
}
