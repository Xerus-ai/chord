import { ExternalLink, FileText, GitBranch, GitPullRequest } from 'lucide-react';
import { useCloudArtifactList } from '@renderer/features/cloud-source/use-cloud-artifact-list';
import { sharingAvailability } from '@renderer/features/sharing/sharing-availability';
import { useLocalAuthor } from '@renderer/features/sharing/use-local-sharing-availability';
import { artifactPathTab } from '@renderer/features/work-list/center-tab';
import { openCenterTab } from '@renderer/features/work-list/center-tabs-store';
import type { CloudWorkItem } from '@renderer/lib/cloud-api';
import { ListRow } from '@renderer/lib/components/list-row';
import { useAuthState } from '@renderer/lib/hooks/useAccount';
import { rpc } from '@renderer/lib/ipc';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { useRailScope } from '../rail-context';
import { PanelShell, RailEmpty, RailSection } from '../rail-primitives';
import { ParticipantsSection } from './participants-section';

/**
 * A teammate's Work item panel: the item's artifacts, what it links to, and
 * the people on it (`ParticipantsSection`, shared with the owner's panel).
 * Everything comes from the cloud — there is no checkout on this machine, so
 * no worktrees or sessions to list; the chats are tabs.
 */
export function CloudWorkItemPanel({ item }: { item: CloudWorkItem }) {
  const { layoutKey, workItemId } = useRailScope();
  const authState = useAuthState();
  const localAuthor = useLocalAuthor();

  const artifacts = useCloudArtifactList(workItemId);

  const rows = artifacts.data ?? [];

  return (
    <PanelShell title="Work item">
      <RailSection sectionId="cloud:artifacts" title="Artifacts" count={rows.length}>
        {rows.length === 0 ? (
          <RailEmpty>{artifacts.isPending ? 'Loading artifacts' : 'No artifacts yet'}</RailEmpty>
        ) : (
          rows.map((artifact) => (
            <ListRow
              key={artifact.id}
              leading={<FileText className="size-icon-sm text-text-passive" />}
              title={artifact.name}
              meta={<RelativeTime value={artifact.updated_at} />}
              navigates
              onOpen={() =>
                openCenterTab(layoutKey, artifactPathTab(artifact.id, artifact.name), {
                  preview: true,
                })
              }
            />
          ))
        )}
      </RailSection>

      <RailSection sectionId="cloud:linked" title="Linked items">
        {!item.pr_number && !item.branch_name && !item.ticket_id ? (
          <RailEmpty>Nothing linked</RailEmpty>
        ) : (
          <>
            {item.ticket_id && (
              <ListRow
                leading={<ExternalLink className="size-icon-sm text-text-passive" />}
                title={item.ticket_id}
                meta={item.ticket_provider ?? 'Ticket'}
                onOpen={
                  item.ticket_url
                    ? () => void rpc.app.openExternal(item.ticket_url as string)
                    : undefined
                }
              />
            )}
            {item.pr_number && (
              <ListRow
                leading={<GitPullRequest className="size-icon-sm text-text-passive" />}
                title={`#${item.pr_number}`}
                meta={item.branch_name ?? 'Pull request'}
                onOpen={
                  item.pr_url ? () => void rpc.app.openExternal(item.pr_url as string) : undefined
                }
              />
            )}
            {item.branch_name && (
              <ListRow
                leading={<GitBranch className="size-icon-sm text-text-passive" />}
                title={item.branch_name}
                meta="Git branch"
              />
            )}
          </>
        )}
      </RailSection>

      <ParticipantsSection
        workItemId={workItemId}
        availability={sharingAvailability({
          authState,
          ownedByAnotherAccount: false,
          synced: true,
          isOwner: false,
          localAuthor,
        })}
      />
    </PanelShell>
  );
}
