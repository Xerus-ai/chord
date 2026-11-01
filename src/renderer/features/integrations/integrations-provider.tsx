import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { createContext, useCallback, useContext } from 'react';
import {
  ISSUE_PROVIDER_CAPABILITIES,
  type ConnectionStatusMap,
  type IssueProviderType,
} from '@shared/issue-providers';
import { rpc } from '@renderer/lib/ipc';
import { useProviderConnection } from './use-provider-connection';

export const ISSUE_CONNECTION_STATUS_QUERY_KEY = ['issues:connection-status'] as const;

const DEFAULT_CONNECTION_STATUS: ConnectionStatusMap = Object.fromEntries(
  Object.entries(ISSUE_PROVIDER_CAPABILITIES).map(([provider, capabilities]) => [
    provider,
    { connected: false, capabilities },
  ])
) as ConnectionStatusMap;

const DEFAULT_CONNECT_ERROR = 'Failed to connect.';

function validateTokenInput(token: string): string | null {
  return token.trim() ? null : 'Invalid API key';
}

function validateJiraCredentials(input: {
  siteUrl: string;
  email: string;
  token: string;
}): string | null {
  if (!input.siteUrl?.trim() || !input.email?.trim() || !input.token?.trim()) {
    return 'Site URL, email, and API token are required.';
  }
  return null;
}

const PROVIDER_CONNECTION_CONFIG = {
  linear: {
    connectMutationFn: (apiKey: string) => rpc.linear.saveToken(apiKey),
    disconnectMutationFn: () => rpc.linear.clearToken(),
    fallbackError: DEFAULT_CONNECT_ERROR,
    validateInput: validateTokenInput,
  },
  jira: {
    connectMutationFn: (credentials: { siteUrl: string; email: string; token: string }) =>
      rpc.jira.saveCredentials(credentials),
    disconnectMutationFn: () => rpc.jira.clearCredentials(),
    fallbackError: DEFAULT_CONNECT_ERROR,
    validateInput: validateJiraCredentials,
  },
} as const;

type IntegrationsContextValue = {
  connectionStatus: ConnectionStatusMap;
  isCheckingConnections: boolean;

  isLinearConnected: boolean | null;
  isJiraConnected: boolean | null;

  isLinearLoading: boolean;
  isJiraLoading: boolean;
  connectLinear: (apiKey: string) => Promise<void>;
  disconnectLinear: () => Promise<void>;
  connectJira: (credentials: { siteUrl: string; email: string; token: string }) => Promise<void>;
  disconnectJira: () => Promise<void>;
};

const IntegrationsContext = createContext<IntegrationsContextValue | null>(null);

function isConnected(
  statusData: ConnectionStatusMap | undefined,
  provider: IssueProviderType
): boolean | null {
  if (!statusData) {
    return null;
  }

  return !!statusData[provider]?.connected;
}

export function IntegrationsProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  const {
    data: statusData,
    isFetching: isCheckingConnections,
    isLoading: isInitialConnectionCheck,
  } = useQuery({
    queryKey: ISSUE_CONNECTION_STATUS_QUERY_KEY,
    queryFn: () => rpc.issues.checkAllConnections(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const invalidateStatuses = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ISSUE_CONNECTION_STATUS_QUERY_KEY });
  }, [queryClient]);

  const linearConnection = useProviderConnection({
    ...PROVIDER_CONNECTION_CONFIG.linear,
    invalidate: invalidateStatuses,
  });
  const jiraConnection = useProviderConnection({
    ...PROVIDER_CONNECTION_CONFIG.jira,
    invalidate: invalidateStatuses,
  });

  const connectionStatus = statusData ?? DEFAULT_CONNECTION_STATUS;

  return (
    <IntegrationsContext.Provider
      value={{
        connectionStatus,
        isCheckingConnections,
        isLinearConnected: isConnected(statusData, 'linear'),
        isJiraConnected: isConnected(statusData, 'jira'),
        isLinearLoading: isInitialConnectionCheck || linearConnection.isLoading,
        isJiraLoading: isInitialConnectionCheck || jiraConnection.isLoading,
        connectLinear: linearConnection.connect,
        disconnectLinear: linearConnection.disconnect,
        connectJira: jiraConnection.connect,
        disconnectJira: jiraConnection.disconnect,
      }}
    >
      {children}
    </IntegrationsContext.Provider>
  );
}

export function useIntegrationsContext() {
  const ctx = useContext(IntegrationsContext);
  if (!ctx) throw new Error('useIntegrationsContext must be used inside IntegrationsProvider');
  return ctx;
}
