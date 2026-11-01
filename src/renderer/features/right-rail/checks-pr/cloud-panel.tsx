import type { CloudGitStateMeta } from '@chord/protocol';
import { GitPullRequest } from 'lucide-react';
import type { CloudWorkItem } from '@renderer/lib/cloud-api';
import { ListRow } from '@renderer/lib/components/list-row';
import { rpc } from '@renderer/lib/ipc';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { PanelShell, RailEmpty } from '../rail-primitives';

/**
 * Checks & PR, read-only: a teammate has no GitHub token for this repo, so
 * the panel links out rather than offering a merge it cannot perform.
 */
export function CloudChecksPrPanel({
  item,
  gitState,
}: {
  item: CloudWorkItem;
  gitState: CloudGitStateMeta | null | undefined;
}) {
  if (!item.pr_number) {
    return (
      <PanelShell title="Checks & PR">
        <RailEmpty>No pull request yet</RailEmpty>
      </PanelShell>
    );
  }

  return (
    <PanelShell title="Checks & PR">
      <ListRow
        leading={<GitPullRequest className="size-icon-sm text-text-passive" />}
        title={`#${item.pr_number}`}
        meta={item.branch_name ?? 'Pull request'}
        navigates
        onOpen={item.pr_url ? () => void rpc.app.openExternal(item.pr_url as string) : undefined}
      />
      <p className="px-3 py-2 text-tiny tracking-tiny text-text-passive">
        {gitState ? (
          <>
            Last synced <RelativeTime value={gitState.captured_at} />
          </>
        ) : (
          'Checks and reviews open on GitHub'
        )}
      </p>
    </PanelShell>
  );
}
