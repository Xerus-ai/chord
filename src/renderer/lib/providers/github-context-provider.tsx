import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  githubAuthErrorChannel,
  githubAuthSuccessChannel,
  githubAuthUserUpdatedChannel,
} from '@shared/events/githubEvents';
import type {
  GitHubAuthResponse,
  GitHubStatusResponse,
  GitHubTokenSource,
  GitHubUser,
} from '@shared/github';
import { events, rpc } from '@renderer/lib/ipc';
import {
  resolveStatusFreshness,
  type GithubStatusFreshness,
} from '@renderer/lib/providers/github-status-state';
import { log } from '@renderer/utils/logger';
import { useToast } from '../hooks/use-toast';
import { useAccountSession, useFetchAccountHealth } from '../hooks/useAccount';
import { useModalContext } from '../modal/modal-provider';

type GithubContextValue = {
  authenticated: boolean;
  user: GitHubUser | null;
  tokenSource: GitHubTokenSource;
  isLoading: boolean;
  /**
   * A status is known — from the last check or the last one that succeeded.
   * Stays true across a failed refresh so a network blip cannot demote a
   * connected account to "unknown"; pair it with `statusError` to tell a fresh
   * answer from a stale one.
   */
  isInitialized: boolean;
  githubLoading: boolean;
  githubStatusMessage: string | undefined;
  needsGhAuth: boolean;
  /**
   * Why the last status check failed, or null when it succeeded. Distinct from
   * `authenticated === false`: the main process no longer reports an
   * unreachable GitHub as a signed-out account, so consumers can render
   * "couldn't check" instead of inviting a pointless reconnect.
   *
   * Read `statusFreshness` rather than this flag to decide what to render —
   * it already distinguishes a stale answer from a missing one.
   */
  statusError: string | null;
  /** Whether `authenticated` is current, last-known-good, or meaningless. */
  statusFreshness: GithubStatusFreshness;
  retryStatus: () => void;
  handleGithubConnect: () => Promise<void>;
  cancelGithubConnect: () => void;
  login: () => Promise<GitHubAuthResponse>;
  logout: () => Promise<void>;
  checkStatus: () => Promise<GitHubStatusResponse>;
};

const GITHUB_STATUS_KEY = ['github:status'] as const;
const ISSUE_CONNECTION_STATUS_QUERY_KEY = ['issues:connection-status'] as const;

const GithubContext = createContext<GithubContextValue | null>(null);

export function GithubContextProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { showModal } = useModalContext();
  const { data: accountSession } = useAccountSession();
  const hasAccount = accountSession?.hasAccount === true;
  const fetchAccountHealth = useFetchAccountHealth();

  const [githubLoading, setGithubLoading] = useState(false);
  const [githubStatusMessage, setGithubStatusMessage] = useState<string | undefined>();

  const {
    data: statusData,
    isFetching,
    error: statusQueryError,
    refetch: refetchStatus,
  } = useQuery<GitHubStatusResponse>({
    queryKey: GITHUB_STATUS_KEY,
    queryFn: () => rpc.github.getStatus(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const authenticated = statusData?.authenticated ?? false;
  const user: GitHubUser | null = statusData?.user ?? null;
  const tokenSource: GitHubTokenSource = statusData?.tokenSource ?? null;
  // Keyed off the retained data rather than `isSuccess`, which drops back to
  // false the moment a background refresh fails: a signed-in user whose
  // network hiccuped would have watched their GitHub state fall back to
  // "unknown" while the app still held a perfectly good answer.
  const isInitialized = statusData !== undefined;

  // Only a status check that actually answered can say the account is not
  // connected. Until one has, nothing prompts the user to reconnect.
  const needsGhAuth = isInitialized && !authenticated;
  const statusError = statusQueryError
    ? statusQueryError instanceof Error
      ? statusQueryError.message
      : String(statusQueryError)
    : null;

  const statusFreshness = resolveStatusFreshness(isInitialized, statusError);

  const retryStatus = useCallback(() => {
    void refetchStatus();
  }, [refetchStatus]);

  const prevAuthenticatedRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (!isInitialized) return;
    if (prevAuthenticatedRef.current === authenticated) return;
    prevAuthenticatedRef.current = authenticated;
    log.info('[GithubContext] auth state changed', {
      authenticated,
      user: user?.login ?? null,
      tokenSource,
    });
  }, [authenticated, isInitialized, tokenSource, user]);

  const loginMutation = useMutation({
    mutationFn: () => rpc.github.auth(),
  });

  const logoutMutation = useMutation({
    mutationFn: () => rpc.github.logout(),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: GITHUB_STATUS_KEY });
      void queryClient.invalidateQueries({ queryKey: ISSUE_CONNECTION_STATUS_QUERY_KEY });
    },
  });

  const isLoading = isFetching || loginMutation.isPending || logoutMutation.isPending;

  const checkStatus = useCallback(async () => {
    return queryClient.fetchQuery<GitHubStatusResponse>({
      queryKey: GITHUB_STATUS_KEY,
      queryFn: () => rpc.github.getStatus(),
      staleTime: 0,
    });
  }, [queryClient]);

  // Fire-and-forget refresh. `getStatus` now rejects instead of reporting a
  // fake disconnect, and the query cache records that rejection for
  // `statusError` — callers that only want fresh data log and move on.
  const refreshStatus = useCallback(() => {
    checkStatus().catch((error: unknown) => {
      log.warn('[GithubContext] status refresh failed', error);
    });
  }, [checkStatus]);

  const login = useCallback(() => loginMutation.mutateAsync(), [loginMutation]);

  const logout = useCallback(async () => {
    await logoutMutation.mutateAsync();
  }, [logoutMutation]);

  const handleDeviceFlowSuccess = useCallback(
    async (flowUser: GitHubUser | null) => {
      log.info('[GithubContext] auth success via device flow', { user: flowUser?.login });
      refreshStatus();
      setTimeout(refreshStatus, 500);
      void queryClient.invalidateQueries({ queryKey: ISSUE_CONNECTION_STATUS_QUERY_KEY });
      toast({
        title: 'Connected to GitHub',
        description: `Signed in as ${flowUser?.login || flowUser?.name || 'user'}`,
      });
    },
    [refreshStatus, queryClient, toast]
  );

  const handleDeviceFlowError = useCallback(
    (error: string) => {
      toast({
        title: 'Authentication Failed',
        description: error,
        variant: 'destructive',
      });
    },
    [toast]
  );

  // Subscribe to GitHub auth IPC events from the main process
  useEffect(() => {
    const cleanupSuccess = events.on(githubAuthSuccessChannel, (data) => {
      log.info('[GithubContext] received githubAuthSuccessChannel event', {
        user: data.user?.login,
      });
      void handleDeviceFlowSuccess(data.user);
    });
    const cleanupError = events.on(githubAuthErrorChannel, (data) => {
      log.info('[GithubContext] received githubAuthErrorChannel event', {
        message: data.message || data.error,
      });
      handleDeviceFlowError(data.message || data.error);
    });
    const cleanupUserUpdated = events.on(githubAuthUserUpdatedChannel, () => {
      log.info('[GithubContext] received githubAuthUserUpdatedChannel event');
      refreshStatus();
    });

    return () => {
      cleanupSuccess();
      cleanupError();
      cleanupUserUpdated();
    };
  }, [handleDeviceFlowSuccess, handleDeviceFlowError, refreshStatus]);

  const handleGithubConnect = useCallback(async () => {
    setGithubLoading(true);
    setGithubStatusMessage(undefined);

    try {
      // A status check that cannot reach GitHub says nothing about whether the
      // account is already connected, so the connect flow continues rather
      // than aborting on an unrelated network failure.
      const freshStatus = await checkStatus().catch((error: unknown) => {
        log.warn('[GithubContext] status check failed before connect', error);
        return null;
      });
      if (freshStatus?.authenticated) {
        setGithubLoading(false);
        setGithubStatusMessage(undefined);
        return;
      }

      const isServerUp = hasAccount && (await fetchAccountHealth());
      if (hasAccount && isServerUp) {
        setGithubStatusMessage('Connecting via Chord account...');
        const oauthResult = await rpc.github.connectOAuth();
        if (oauthResult?.success) {
          await checkStatus();
          void queryClient.invalidateQueries({ queryKey: ISSUE_CONNECTION_STATUS_QUERY_KEY });
          if (oauthResult.user) {
            toast({
              title: 'Connected to GitHub',
              description: `Signed in as ${oauthResult.user.login || oauthResult.user.name || 'user'}`,
            });
          }
          setGithubLoading(false);
          setGithubStatusMessage(undefined);
          return;
        }
      }

      setGithubLoading(false);
      setGithubStatusMessage(undefined);

      showModal('githubDeviceFlowModal', {
        onError: handleDeviceFlowError,
      });
      void login();
    } catch (error) {
      log.error('GitHub connection error:', error);
      setGithubLoading(false);
      setGithubStatusMessage(undefined);
      toast({
        title: 'Connection Failed',
        description: 'Failed to connect to GitHub. Please try again.',
        variant: 'destructive',
      });
    }
  }, [
    toast,
    checkStatus,
    login,
    showModal,
    handleDeviceFlowError,
    hasAccount,
    fetchAccountHealth,
    queryClient,
  ]);

  const cancelGithubConnect = useCallback(() => {
    const flowLabel = githubStatusMessage ? 'OAuth flow' : 'Device flow';
    setGithubLoading(false);
    setGithubStatusMessage(undefined);
    void rpc.github.authCancel();
    toast({
      title: 'GitHub connection unsuccessful',
      description: `${flowLabel} was canceled`,
    });
  }, [githubStatusMessage, toast]);

  const value: GithubContextValue = {
    authenticated,
    user,
    tokenSource,
    isLoading,
    isInitialized,
    githubLoading,
    githubStatusMessage,
    needsGhAuth,
    statusError,
    statusFreshness,
    retryStatus,
    handleGithubConnect,
    cancelGithubConnect,
    login,
    logout,
    checkStatus,
  };

  return <GithubContext.Provider value={value}>{children}</GithubContext.Provider>;
}

export function useGithubContext() {
  const ctx = useContext(GithubContext);
  if (!ctx) {
    throw new Error('useGithubContext must be used inside GithubContextProvider');
  }
  return ctx;
}
