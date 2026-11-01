import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { accountStateChangedChannel, type AuthState } from '@shared/events/accountEvents';
import { events, rpc } from '@renderer/lib/ipc';
import { queryClient } from '@renderer/lib/query-client';
import { forgetAllWorkItemVersions } from '@renderer/lib/sync/work-item-version-guard';

export const ACCOUNT_SESSION_KEY = ['account:session'] as const;
const ACCOUNT_HEALTH_KEY = ['account:health'] as const;

/** Re-reads the session the moment main detects an auth transition (e.g. a
 *  background refresh dying with invalid_grant) instead of on the next poll. */
export function wireAccountStateInvalidation(): void {
  events.on(accountStateChangedChannel, () => {
    void queryClient.invalidateQueries({ queryKey: [...ACCOUNT_SESSION_KEY] });
  });
}

export function useAccountSession() {
  return useQuery({
    queryKey: ACCOUNT_SESSION_KEY,
    queryFn: () => rpc.account.getSession(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Session health for gating cloud surfaces. `undefined` while the first read
 * is in flight — callers must treat that as "unknown", not "signed out",
 * or every cloud panel flashes its paused state on boot.
 */
export function useAuthState(): AuthState | undefined {
  return useAccountSession().data?.authState;
}

export function useAccountSignIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => rpc.account.signIn(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...ACCOUNT_SESSION_KEY] });
      void queryClient.invalidateQueries({ queryKey: ['github:status'] });
    },
  });
}

export function useAccountSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => rpc.account.signOut(),
    onSuccess: () => {
      // Version watermarks are per-account; the next account's fetches must
      // not be dropped against the previous account's guard state.
      forgetAllWorkItemVersions();
      void queryClient.invalidateQueries({ queryKey: [...ACCOUNT_SESSION_KEY] });
    },
  });
}

export function useAccountHealth() {
  return useQuery({
    queryKey: ACCOUNT_HEALTH_KEY,
    queryFn: () => rpc.account.checkHealth(),
    staleTime: 60_000,
  });
}

export function useFetchAccountHealth() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.fetchQuery({
      queryKey: ACCOUNT_HEALTH_KEY,
      queryFn: () => rpc.account.checkHealth(),
      staleTime: 0,
    });
}
