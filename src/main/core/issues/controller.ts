import { createRPCController } from '@shared/ipc/rpc';
import type {
  ConnectionStatus,
  ConnectionStatusMap,
  IssueProviderType,
} from '@shared/issue-providers';
import { err, type Result } from '@shared/result';
import type { IssueLookupError, IssueRef, WorkItemTicket } from '@shared/work-item-ticket';
import { projectManager } from '@main/core/projects/project-manager';
import type { IssueProvider, IssueQueryOpts, IssueSearchOpts } from './issue-provider';
import { getAllIssueProviders, getIssueProvider } from './registry';
import { resolveIssueQueryRemote } from './resolve-issue-remote';

const DEFAULT_CAPABILITIES = {
  requiresProjectPath: false,
  requiresRepositoryUrl: false,
} as const;

const CONNECTION_CHECK_TIMEOUT_MS = 8_000;

function timeoutStatus(provider: IssueProvider): ConnectionStatus {
  return {
    connected: false,
    error: `Connection check timed out after ${CONNECTION_CHECK_TIMEOUT_MS}ms.`,
    capabilities: provider.capabilities,
  };
}

function failureStatus(provider: IssueProvider, error: unknown): ConnectionStatus {
  const message = error instanceof Error ? error.message : 'Connection check failed.';
  return {
    connected: false,
    error: message,
    capabilities: provider.capabilities,
  };
}

async function checkProviderConnection(provider: IssueProvider): Promise<ConnectionStatus> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<ConnectionStatus>((resolve) => {
    timeoutId = setTimeout(() => {
      resolve(timeoutStatus(provider));
    }, CONNECTION_CHECK_TIMEOUT_MS);
  });

  try {
    return await Promise.race([provider.checkConnection(), timeoutPromise]);
  } catch (error) {
    return failureStatus(provider, error);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function withResolvedRemote<T extends IssueQueryOpts>(opts: T): Promise<T> {
  return resolveIssueQueryRemote(
    opts,
    (projectId) => projectManager.getProject(projectId)?.repository
  );
}

export const issueController = createRPCController({
  checkConnection: async (provider: IssueProviderType) => {
    const issueProvider = getIssueProvider(provider);
    if (!issueProvider) {
      return {
        connected: false,
        error: `Unknown provider: ${provider}`,
        capabilities: DEFAULT_CAPABILITIES,
      };
    }

    return checkProviderConnection(issueProvider);
  },

  checkAllConnections: async (): Promise<ConnectionStatusMap> => {
    const providers = getAllIssueProviders();

    const settled = await Promise.all(
      providers.map(async (provider) => {
        const status = await checkProviderConnection(provider);
        return [provider.type, status] as const;
      })
    );

    return Object.fromEntries(settled) as ConnectionStatusMap;
  },

  listIssues: async (provider: IssueProviderType, opts: IssueQueryOpts) => {
    const issueProvider = getIssueProvider(provider);
    if (!issueProvider) {
      return { success: false, error: `Unknown provider: ${provider}` } as const;
    }

    return issueProvider.listIssues(await withResolvedRemote(opts));
  },

  searchIssues: async (provider: IssueProviderType, opts: IssueSearchOpts) => {
    const issueProvider = getIssueProvider(provider);
    if (!issueProvider) {
      return { success: false, error: `Unknown provider: ${provider}` } as const;
    }

    return issueProvider.searchIssues(await withResolvedRemote(opts));
  },

  /** The create dialog's ticket lookup: a GitHub ref is read in the owner/repo it names. */
  getIssue: async (ref: IssueRef): Promise<Result<WorkItemTicket, IssueLookupError>> => {
    const issueProvider = getIssueProvider(ref.provider);
    if (!issueProvider) {
      return err({ type: 'error', message: `Unknown provider: ${ref.provider}` });
    }
    return issueProvider.getIssue(ref);
  },
});
