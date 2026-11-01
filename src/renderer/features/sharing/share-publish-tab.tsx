import { Loader2 } from 'lucide-react';
import type { ArtifactType } from '@shared/stream-items';
import { ConfluencePublishPanel } from '@renderer/features/confluence/confluence-publish-panel';
import { SharePublicLink } from './share-public-link';
import type { ShareScope } from './share-scope';
import { useSharing } from './use-sharing';

/**
 * The Share dialog's Publish tab (shared-items design §5): copies outside
 * Chord, for one artifact. The public link, then Confluence.
 */
export function SharePublishTab({
  workItemId,
  scope,
  artifactType,
}: {
  workItemId: string;
  scope: ShareScope;
  /** The picked artifact's format; null for the whole work item. */
  artifactType: ArtifactType | null;
}) {
  if (scope.kind === 'work_item' || artifactType === null) {
    return (
      <p className="py-2 text-tiny tracking-tiny text-text-passive" data-testid="publish-pick">
        Pick an artifact under What to publish it outside Chord.
      </p>
    );
  }
  return <ArtifactPublishing workItemId={workItemId} scope={scope} artifactType={artifactType} />;
}

function ArtifactPublishing({
  workItemId,
  scope,
  artifactType,
}: {
  workItemId: string;
  scope: Extract<ShareScope, { kind: 'artifact' }>;
  artifactType: ArtifactType;
}) {
  const sharing = useSharing({ workItemId, artifactId: scope.artifactId });
  const state = sharing.state;
  if (!state) {
    return sharing.error ? (
      <p className="text-tiny tracking-tiny text-status-err">
        {sharing.error instanceof Error ? sharing.error.message : 'Failed to load sharing'}
      </p>
    ) : (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-text-passive" />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <SharePublicLink
        state={state}
        onChange={sharing.setGeneralAccess}
        onLinkCommentsChange={sharing.setLinkComments}
      />
      <div className="flex flex-col gap-2">
        <span className="text-body tracking-body text-text">Confluence</span>
        <ConfluencePublishPanel
          artifact={{ id: scope.artifactId, name: scope.name, type: artifactType }}
          teamId={state.team.id}
        />
      </div>
    </div>
  );
}
