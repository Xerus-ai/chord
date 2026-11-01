import { isValidProviderId, type AgentProviderId } from '@shared/agent-provider-registry';

/**
 * The provider a send runs on. A send inside a thread keeps that session
 * row's own provider — parallel sessions can run different agents, so nothing
 * outside the thread may make `deliverToLiveSession` see a provider change and
 * stop it. A send with no thread yet (the launcher starting a fresh chat) runs
 * the agent the composer shows — its pill can resolve from the default-agent
 * setting while the work item has none — then the work item's own provider.
 * Null when nothing names an agent: the caller reports it instead of silently
 * picking one.
 */
export function resolveSendProvider(args: {
  targetRowProvider: string | null | undefined;
  requestedProvider: string | null | undefined;
  itemProvider: string | null;
}): AgentProviderId | null {
  if (isValidProviderId(args.targetRowProvider)) return args.targetRowProvider;
  if (isValidProviderId(args.requestedProvider)) return args.requestedProvider;
  if (isValidProviderId(args.itemProvider)) return args.itemProvider;
  return null;
}
