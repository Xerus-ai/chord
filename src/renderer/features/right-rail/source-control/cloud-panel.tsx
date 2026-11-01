import type { CloudGitStateMeta } from '@chord/protocol';
import { GitBranch } from 'lucide-react';
import { ViewerChips } from '@renderer/features/work-list/file-row';
import type { WorkItemViewer } from '@renderer/features/work-list/use-viewing-presence';
import { ListRow } from '@renderer/lib/components/list-row';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { FileGlyph } from '../file-icon';
import { PanelShell, RailEmpty, RailSection } from '../rail-primitives';

export interface CloudGitStateProps {
  gitState: CloudGitStateMeta | null | undefined;
  isPending: boolean;
  hasError: boolean;
  ownerLabel: string | null;
  viewers: WorkItemViewer[];
  selectedFile: string | null;
  onFileSelect: (filePath: string) => void;
}

/**
 * Source Control, read-only. Two distinct empty states the old Changes tab
 * established and this keeps: never-synced (no snapshot row at all) is not the
 * same as a snapshot that says the tree is clean, and conflating them tells a
 * teammate "no changes" when the truth is "nothing has arrived".
 */
export function CloudSourceControlPanel(props: CloudGitStateProps) {
  const { gitState } = props;
  const viewersByFile = new Map<string, WorkItemViewer[]>();
  for (const viewer of props.viewers) {
    const list = viewersByFile.get(viewer.file);
    if (list) list.push(viewer);
    else viewersByFile.set(viewer.file, [viewer]);
  }

  if (props.isPending) {
    return (
      <PanelShell title="Source Control">
        <RailEmpty>Loading changes</RailEmpty>
      </PanelShell>
    );
  }
  if (props.hasError) {
    return (
      <PanelShell title="Source Control">
        <RailEmpty>Changes unavailable</RailEmpty>
      </PanelShell>
    );
  }
  if (!gitState) {
    return (
      <PanelShell title="Source Control">
        <RailEmpty>
          {props.ownerLabel
            ? `${props.ownerLabel} hasn't synced changes yet`
            : 'No changes synced yet'}
        </RailEmpty>
      </PanelShell>
    );
  }

  const totals = gitState.files.reduce(
    (sums, file) => ({
      added: sums.added + file.additions,
      removed: sums.removed + file.deletions,
    }),
    { added: 0, removed: 0 }
  );

  return (
    <PanelShell title="Source Control">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border-subtle px-3 py-2">
        <GitBranch className="size-icon-sm shrink-0 text-text-passive" />
        <span
          className="min-w-0 flex-1 truncate font-mono text-tiny tracking-tiny text-text"
          style={{ fontVariantLigatures: 'none' }}
        >
          {gitState.branch_name ?? 'Unknown branch'}
        </span>
        <span className="shrink-0 text-tiny tracking-tiny text-text-passive">
          Last synced <RelativeTime value={gitState.captured_at} />
        </span>
      </div>

      <RailSection
        sectionId="cloud:changes"
        title="Changes"
        count={gitState.files.length}
        trailing={
          <span className="flex shrink-0 gap-1 pl-2 font-mono text-tiny tracking-tiny tabular-nums">
            {totals.added > 0 && <span className="text-status-ok">+{totals.added}</span>}
            {totals.removed > 0 && <span className="text-status-err">-{totals.removed}</span>}
          </span>
        }
      >
        {gitState.files.length === 0 ? (
          <RailEmpty>Up to date, no changes</RailEmpty>
        ) : (
          gitState.files.map((file) => (
            <ListRow
              key={file.path}
              leading={<FileGlyph fileName={file.path} />}
              title={file.path.split('/').pop() ?? file.path}
              meta={file.path}
              tooltip={file.path}
              selected={props.selectedFile === file.path}
              onOpen={() => props.onFileSelect(file.path)}
              trailing={
                <>
                  <span className="flex shrink-0 gap-1 font-mono text-tiny tracking-tiny tabular-nums">
                    {file.additions > 0 && (
                      <span className="text-status-ok">+{file.additions}</span>
                    )}
                    {file.deletions > 0 && (
                      <span className="text-status-err">-{file.deletions}</span>
                    )}
                  </span>
                  {viewersByFile.has(file.path) && (
                    <ViewerChips viewers={viewersByFile.get(file.path) as WorkItemViewer[]} />
                  )}
                </>
              }
            />
          ))
        )}
      </RailSection>
    </PanelShell>
  );
}
