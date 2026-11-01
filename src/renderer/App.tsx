import { QueryClientProvider } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { Workspace } from './app/workspace';
import { AppSidebar } from './features/app-sidebar/app-sidebar';
import { AuthGate } from './features/auth/auth-gate';
import { useDeepLinkNavigation } from './features/deep-links/use-deep-link-navigation';
import { IntegrationsProvider } from './features/integrations/integrations-provider';
import { NotificationDropdown } from './features/notifications/notification-dropdown';
import { useNotifications } from './features/notifications/use-notifications';
import { OnboardingView } from './features/onboarding/onboarding-view';
import { useAccountSession } from './lib/hooks/useAccount';
import { WorkspaceLayoutContextProvider } from './lib/layout/layout-provider';
import { WorkspaceViewProvider } from './lib/layout/provider';
import { ModalProvider } from './lib/modal/modal-provider';
import { scheduleMonacoWarmup } from './lib/monaco/warm-monaco';
import { GithubContextProvider } from './lib/providers/github-context-provider';
import { PostHogFeatureFlagsProvider } from './lib/providers/posthog-provider';
import { ThemeProvider } from './lib/providers/theme-provider';
import { TerminalPoolProvider } from './lib/pty/pty-pool-provider';
import { queryClient } from './lib/query-client';
import { navigationStore } from './lib/stores/navigation-store';
import { SyncSocketContextProvider } from './lib/sync/sync-socket-provider';
import { RightSidebarProvider } from './lib/ui/right-sidebar';
import { TooltipProvider } from './lib/ui/tooltip';
import { cn } from './utils/utils';

const ONBOARDING_KEY_PREFIX = 'chord:has-seen-onboarding:v2:';
const LEGACY_ONBOARDING_KEY = 'chord:has-seen-onboarding:v1';

// Keyed per account: the machine-wide v1 flag meant the second account to
// sign in on a machine never saw onboarding (and nobody could replay it).
// The legacy flag is claimed by the first account that reads it — that
// account had genuinely seen onboarding under the old semantics; any account
// after it starts fresh. Idempotent, so safe to call during render.
function hasSeenOnboarding(userId: string): boolean {
  const key = ONBOARDING_KEY_PREFIX + userId;
  if (localStorage.getItem(key) === 'true') return true;
  if (localStorage.getItem(LEGACY_ONBOARDING_KEY) === 'true') {
    localStorage.setItem(key, 'true');
    localStorage.removeItem(LEGACY_ONBOARDING_KEY);
    return true;
  }
  return false;
}

// Everything below the provider stack: the shell owns the state the top bar
// and the workspace both act on, so the bell reflects real unread counts and
// the search button opens the palette directly.
function AppShell() {
  const [notifOpen, setNotifOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  useDeepLinkNavigation();
  // Monaco loads once the shell is up, never ahead of it.
  useEffect(scheduleMonacoWarmup, []);

  // Full-bleed panes split by hairlines, no gutters or rounded cards.
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface">
      <Workspace
        commandPaletteOpen={commandPaletteOpen}
        onCommandPaletteOpenChange={setCommandPaletteOpen}
        leftSidebar={
          <AppSidebar
            onOpenSearch={() => setCommandPaletteOpen(true)}
            onToggleNotifications={() => setNotifOpen((p) => !p)}
            hasUnreadNotifications={unreadCount > 0}
          />
        }
      />
      <NotificationDropdown
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        notifications={notifications}
        unreadCount={unreadCount}
        onMarkAsRead={markAsRead}
        onMarkAllAsRead={markAllAsRead}
      />
    </div>
  );
}

function AppContent() {
  return (
    <TooltipProvider delay={300}>
      <ModalProvider>
        <SyncSocketContextProvider>
          <WorkspaceLayoutContextProvider>
            <TerminalPoolProvider>
              <GithubContextProvider>
                <IntegrationsProvider>
                  <WorkspaceViewProvider>
                    <RightSidebarProvider>
                      <ThemeProvider>
                        <AppShell />
                      </ThemeProvider>
                    </RightSidebarProvider>
                  </WorkspaceViewProvider>
                </IntegrationsProvider>
              </GithubContextProvider>
            </TerminalPoolProvider>
          </WorkspaceLayoutContextProvider>
        </SyncSocketContextProvider>
      </ModalProvider>
    </TooltipProvider>
  );
}

function SessionUnavailable({
  message,
  retrying,
  onRetry,
}: {
  message: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="flex h-screen select-none flex-col items-center justify-center gap-4 bg-surface">
      <div className="flex flex-col items-center gap-1.5">
        <p className="text-title tracking-title font-semibold text-text">
          Could not read your session
        </p>
        <p className="max-w-[320px] text-center text-body tracking-body text-status-err">
          {message}
        </p>
      </div>
      <button
        onClick={onRetry}
        disabled={retrying}
        className={cn(
          'flex items-center gap-2 rounded-lg px-6 py-2 text-title tracking-title font-semibold transition-all duration-200',
          'bg-action-bg text-action-fg',
          retrying ? 'cursor-wait opacity-70' : 'hover:bg-action-bg-hover'
        )}
      >
        {retrying ? 'Retrying...' : 'Try again'}
      </button>
    </div>
  );
}

function AppRoot() {
  // The session query is the single source of truth for the gate. Settings
  // sign-out invalidates this key, so the gate re-renders straight back to
  // AuthGate instead of leaving a signed-out app running until restart.
  const { data: session, error, isFetching, refetch } = useAccountSession();
  const userId = session?.isSignedIn
    ? ((session.user as { userId?: string } | undefined)?.userId ?? null)
    : null;
  // State only forces the re-render on completion; the flag itself lives in
  // localStorage under the CURRENT account's key, so switching accounts
  // re-evaluates against the new account rather than carrying this over.
  const [onboardingCompletedFor, setOnboardingCompletedFor] = useState<string | null>(null);
  // A signed-in session with no userId can't persist a per-account flag —
  // counts as done rather than trapping the user in unfinishable onboarding.
  // (Signed-out renders return before this value is ever read.)
  const onboardingDone =
    userId === null || onboardingCompletedFor === userId || hasSeenOnboarding(userId);

  const handleReadSession = useCallback(() => {
    void refetch();
  }, [refetch]);

  const handleOnboardingComplete = useCallback(() => {
    if (userId) {
      localStorage.setItem(ONBOARDING_KEY_PREFIX + userId, 'true');
    }
    navigationStore.getState().restoreSnapshot({ currentViewId: 'dashboard' });
    setOnboardingCompletedFor(userId);
  }, [userId]);

  // No session data yet: unknown, never "signed out". A read that failed
  // outright gets a retry screen; one still in flight keeps the blank
  // placeholder. Once data exists it is kept across background refetch
  // failures, so a transient error never evicts a signed-in user.
  if (!session) {
    if (error) {
      return (
        <ThemeProvider>
          <SessionUnavailable
            message={error instanceof Error ? error.message : String(error)}
            retrying={isFetching}
            onRetry={handleReadSession}
          />
        </ThemeProvider>
      );
    }
    return (
      <ThemeProvider>
        <div className="flex h-screen items-center justify-center bg-surface" />
      </ThemeProvider>
    );
  }

  if (!session.isSignedIn) {
    return (
      <ThemeProvider>
        <AuthGate onAuthenticated={handleReadSession} />
      </ThemeProvider>
    );
  }

  if (!onboardingDone) {
    return (
      <ThemeProvider>
        <OnboardingView onComplete={handleOnboardingComplete} />
      </ThemeProvider>
    );
  }

  return <AppContent />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <PostHogFeatureFlagsProvider>
        <AppRoot />
      </PostHogFeatureFlagsProvider>
    </QueryClientProvider>
  );
}
