import type { DocumentTab } from './center-tab';
import { CommitPanel } from './commit-panel';
import type { DocumentBodyContext } from './pane-host';
import { PathTabBody } from './path-tab-body';

/** The owner's body for a document tab: a commit, or a path (a file, an artifact, or both). */
export function OwnerDocumentBody({
  workItemId,
  tab,
  context,
}: {
  workItemId: string;
  tab: DocumentTab;
  context: DocumentBodyContext;
}) {
  if (tab.kind === 'commit') {
    return (
      <CommitPanel
        key={`${tab.worktreeId}:${tab.sha}`}
        workItemId={workItemId}
        worktreeId={tab.worktreeId}
        sha={tab.sha}
      />
    );
  }
  return <PathTabBody workItemId={workItemId} tab={tab} context={context} />;
}
