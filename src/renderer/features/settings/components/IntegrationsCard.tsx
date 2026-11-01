import { Check, Loader2, Plus, RotateCw } from 'lucide-react';
import React, { useEffect } from 'react';
import githubSvg from '@/assets/images/Github.svg?raw';
import jiraSvg from '@/assets/images/Jira.svg?raw';
import linearSvg from '@/assets/images/Linear.svg?raw';
import atlassianSvg from '@/assets/images/mcp/atlassian.svg?raw';
import { useConfluenceConnection } from '@renderer/features/confluence/use-confluence';
import { useIntegrationsContext } from '@renderer/features/integrations/integrations-provider';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { useGithubContext } from '@renderer/lib/providers/github-context-provider';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';

const SvgLogo = ({ raw }: { raw: string }) => {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'chord-dark';

  const processed = isDark
    ? raw
        .replace(/\bfill="[^"]*"/g, 'fill="currentColor"')
        .replace(/\bstroke="[^"]*"/g, 'stroke="currentColor"')
    : raw;

  return (
    <span
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center [&_svg]:h-full [&_svg]:w-full [&_svg]:shrink-0',
        isDark && 'text-text'
      )}
      dangerouslySetInnerHTML={{ __html: processed }}
    />
  );
};

interface IntegrationRow {
  id: string;
  name: string;
  description: string;
  logoSvg: string;
  connected: boolean;
  loading: boolean;
  /** Set when the last status check failed, whether or not an earlier answer
      is still on hand — `statusUnknown` is what says there is nothing to fall
      back to. */
  statusError?: string | null;
  /** No status has ever been obtained, so `connected` means nothing here. */
  statusUnknown?: boolean;
  /** `connected` is the last known good value; the latest refresh failed. */
  statusStale?: boolean;
  onRetryStatus?: () => void;
  onConnect: () => void | Promise<void>;
  onCancel?: () => void;
  onDisconnect: () => void | Promise<void>;
  disabledTooltip?: string;
}

const IntegrationsCard: React.FC = () => {
  const {
    authenticated,
    isLoading,
    githubLoading,
    handleGithubConnect,
    cancelGithubConnect,
    logout,
    tokenSource,
    statusError,
    statusFreshness,
    retryStatus,
  } = useGithubContext();
  const {
    connectionStatus,
    isLinearConnected,
    isLinearLoading,
    disconnectLinear,
    isJiraConnected,
    isJiraLoading,
    disconnectJira,
  } = useIntegrationsContext();

  const showIntegrationSetup = useShowModal('integrationSetupModal');
  const confluence = useConfluenceConnection();
  const confluenceStatus = confluence.status;

  const isCliManaged = authenticated && tokenSource === 'cli';
  const githubStatusUnknown = statusFreshness === 'unknown';
  const githubStatusStale = statusFreshness === 'stale';

  useEffect(() => {
    retryStatus();
  }, [retryStatus]);

  const integrations: IntegrationRow[] = [
    {
      id: 'github',
      name: 'GitHub',
      // Three states, not two: an unreachable GitHub is reported as such
      // instead of borrowing the "not connected" copy and inviting a
      // reconnect that would not have fixed anything. A failed refresh on top
      // of a known state keeps that state and only marks it stale.
      description: githubStatusUnknown
        ? "Couldn't check the connection"
        : authenticated
          ? 'Connected'
          : 'Connect your repositories',
      logoSvg: githubSvg,
      connected: authenticated,
      loading: isLoading || githubLoading,
      statusError,
      statusUnknown: githubStatusUnknown,
      statusStale: githubStatusStale,
      onRetryStatus: retryStatus,
      onConnect: handleGithubConnect,
      onCancel: cancelGithubConnect,
      onDisconnect: logout,
      disabledTooltip: isCliManaged
        ? 'Run `gh auth logout` in your terminal to disconnect'
        : undefined,
    },
    {
      id: 'linear',
      name: 'Linear',
      description:
        isLinearConnected && connectionStatus.linear.displayName
          ? connectionStatus.linear.displayName
          : 'Work on Linear tickets',
      logoSvg: linearSvg,
      connected: !!isLinearConnected,
      loading: isLinearLoading,
      onConnect: () => showIntegrationSetup({ integration: 'linear' }),
      onDisconnect: disconnectLinear,
    },
    {
      id: 'jira',
      name: 'Jira',
      description:
        isJiraConnected && connectionStatus.jira.displayName
          ? connectionStatus.jira.displayName
          : 'Work on Jira tickets',
      logoSvg: jiraSvg,
      connected: !!isJiraConnected,
      loading: isJiraLoading,
      onConnect: () => showIntegrationSetup({ integration: 'jira' }),
      onDisconnect: disconnectJira,
    },
    {
      id: 'confluence',
      name: 'Confluence',
      description: confluenceStatus?.connected
        ? `Connected · ${new URL(confluenceStatus.siteUrl).host}`
        : 'Publish artifacts as pages',
      // The shared asset has no fill; currentColor keeps it visible in both themes.
      logoSvg: atlassianSvg.replace('<svg ', '<svg fill="currentColor" '),
      connected: confluenceStatus?.connected === true,
      loading:
        confluence.isLoading || confluence.connect.isPending || confluence.disconnect.isPending,
      // Stored credentials that no longer work: say why, and offer to reconnect.
      statusError:
        confluenceStatus && !confluenceStatus.connected ? (confluenceStatus.error ?? null) : null,
      onConnect: () => showIntegrationSetup({ integration: 'confluence' }),
      onDisconnect: () => confluence.disconnect.mutate(),
    },
  ];

  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}
    >
      {integrations.map((integration) => (
        <div key={integration.id} className="flex h-full min-h-0">
          <div className="flex w-full items-center gap-4 rounded-lg border border-border bg-surface-raised p-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-surface-inset">
              <SvgLogo raw={integration.logoSvg} />
            </div>
            <div className="flex flex-1 flex-col gap-0.5">
              <h3 className="text-body tracking-body font-medium text-text">{integration.name}</h3>
              <p
                className={cn(
                  'text-body tracking-body',
                  integration.statusUnknown ? 'text-status-err' : 'text-text-passive'
                )}
              >
                {integration.description}
              </p>
              {integration.statusError && (
                <p className="max-w-full break-words text-micro tracking-micro text-text-passive">
                  {integration.statusUnknown
                    ? integration.statusError
                    : `Last checked state shown — refresh failed: ${integration.statusError}`}
                </p>
              )}
            </div>
            {/* Stale but known: the real control stays put and the refresh
                gets its own button, so a blip never takes the connected or
                connect action away. */}
            {integration.statusStale && integration.onRetryStatus && (
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className="shrink-0"
                onClick={integration.onRetryStatus}
                aria-label={`Recheck ${integration.name}`}
              >
                <RotateCw className="h-4 w-4 text-text-passive" />
              </Button>
            )}
            {integration.statusUnknown && integration.onRetryStatus ? (
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className="shrink-0"
                onClick={integration.onRetryStatus}
                aria-label={`Retry checking ${integration.name}`}
              >
                {integration.loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCw className="h-4 w-4 text-status-err" />
                )}
              </Button>
            ) : integration.connected ? (
              integration.disabledTooltip ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger
                      className="inline-flex h-8 w-8 shrink-0 cursor-default items-center justify-center rounded-md border border-border bg-surface opacity-70"
                      aria-label={integration.disabledTooltip}
                    >
                      <Check className="h-4 w-4 text-status-ok" />
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p className="text-tiny tracking-tiny">{integration.disabledTooltip}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  className="shrink-0"
                  onClick={integration.onDisconnect}
                  aria-label={`Disconnect ${integration.name}`}
                >
                  <Check className="h-4 w-4 text-status-ok" />
                </Button>
              )
            ) : (
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className="shrink-0"
                onClick={
                  integration.loading && integration.onCancel
                    ? integration.onCancel
                    : integration.onConnect
                }
                aria-label={
                  integration.loading
                    ? `Cancel connecting ${integration.name}`
                    : `Connect ${integration.name}`
                }
              >
                {integration.loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default IntegrationsCard;
