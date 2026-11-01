import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Loader2 } from 'lucide-react';
import { isLiveDocumentType } from '@shared/confluence';
import type { ArtifactType } from '@shared/stream-items';
import { sharingApi } from '@renderer/features/sharing/sharing-api';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { cn } from '@renderer/utils/utils';
import { describeConfluencePublish } from './confluence-publish-state';
import { usePublishableArtifacts } from './publishable-artifacts';
import { useConfluenceConnection, useConfluencePublication } from './use-confluence';

const noop = () => {};

/**
 * Publish tab › Confluence (shared-items design §5): the page's state and its
 * one action, in the states the design lists. A document publishes what its
 * open editor holds, so a document whose tab is closed asks to be opened.
 */
export function ConfluencePublishPanel({
  artifact,
  teamId,
}: {
  artifact: { id: string; name: string; type: ArtifactType };
  teamId: string;
}) {
  const showConnect = useShowModal('integrationSetupModal');
  const open = usePublishableArtifacts((state) => state.open[artifact.id]);
  const needsOpenTab = isLiveDocumentType(artifact.type) && open?.content == null;
  const connection = useConfluenceConnection();
  const policy = useQuery({
    queryKey: ['sharing-policy', teamId],
    queryFn: () => sharingApi.getSharingPolicy(teamId),
  });
  const connected = connection.status ? connection.status.connected : null;
  const policyAllows = policy.data ? policy.data.allow_confluence_publishing : null;
  const { status, statusError, publish } = useConfluencePublication({
    artifactId: artifact.id,
    artifactType: artifact.type,
    content: open?.content ?? '',
    onPublished: open?.onPublished ?? noop,
    enabled: connected === true && policyAllows === true && !needsOpenTab,
  });

  if (policy.error instanceof Error) {
    return (
      <p className="text-tiny tracking-tiny text-status-err">
        Couldn&apos;t read your team&apos;s publishing policy: {policy.error.message}
      </p>
    );
  }
  const state = describeConfluencePublish({
    connected,
    policyAllows,
    failure: publish.error?.message ?? statusError ?? null,
    status: status ?? null,
  });
  const busy = publish.isPending;
  const published = status && status.state !== 'unpublished' ? status : null;

  return (
    <div
      className="flex items-center gap-2"
      data-testid="publish-confluence"
      data-state={state.kind}
    >
      {state.tone && (
        <span
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            state.tone === 'ok' && 'bg-status-ok',
            state.tone === 'warn' && 'bg-status-warn',
            state.tone === 'err' && 'bg-status-err'
          )}
        />
      )}
      <span className="min-w-0 flex-1 text-tiny tracking-tiny text-text-muted">
        {needsOpenTab && state.action !== 'connect' && state.kind !== 'policy_off'
          ? `Open ${artifact.name} to publish what its editor holds`
          : state.label}
      </span>
      {busy && <Loader2 className="h-3 w-3 animate-spin text-text-passive" />}
      {state.action === 'connect' && (
        <Button size="xs" onClick={() => showConnect({ integration: 'confluence' })}>
          Connect Confluence
        </Button>
      )}
      {!needsOpenTab &&
        (state.action === 'publish' || state.action === 'retry' || state.action === 'update') && (
          <Button
            size="xs"
            disabled={busy}
            onClick={() => publish.mutate({ overwriteRemoteEdits: false })}
          >
            {state.action === 'publish'
              ? 'Publish to Confluence'
              : state.action === 'update'
                ? 'Update Confluence'
                : 'Retry'}
          </Button>
        )}
      {!needsOpenTab && state.action === 'overwrite' && (
        <Button
          size="xs"
          variant="destructive"
          disabled={busy}
          onClick={() => publish.mutate({ overwriteRemoteEdits: true })}
        >
          Overwrite their edits
        </Button>
      )}
      {published && (
        <Button
          size="xs"
          variant="outline"
          onClick={() => void rpc.app.openExternal(published.pageUrl)}
        >
          <ExternalLink />
          Open
        </Button>
      )}
    </div>
  );
}
