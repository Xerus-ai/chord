import { ChevronDown, FolderGit2 } from 'lucide-react';
import { useState } from 'react';
import type {
  DiscoveredWorktree,
  RepoWorktreeSources,
  RepoWorktreeSourcesFailure,
} from '@shared/worktree-sources';
import { cn } from '@renderer/utils/utils';
import { describeWorktreeReviewLine } from './worktree-sources-model';

export interface DiscoveredWorktreeActions {
  onAdopt: (repoId: string, worktree: DiscoveredWorktree) => void;
  onHideReview: (repoId: string) => void;
}

const SOURCE_LABEL: Record<DiscoveredWorktree['source'], string> = {
  claudeCode: 'Claude Code',
  other: 'Other',
};

const smallButton =
  'shrink-0 cursor-pointer rounded-xs px-1.5 py-0.5 text-list-meta font-semibold text-text-muted transition-colors hover:bg-surface-hover-solid hover:text-text';

function folderName(folder: string): string {
  return folder.split(/[\\/]/).filter(Boolean).pop() ?? folder;
}

/** One checkout Chord did not make, with Adopt. */
function DiscoveredRow({
  repoId,
  worktree,
  attribute,
  onAdopt,
}: {
  repoId: string;
  worktree: DiscoveredWorktree;
  /** Listed rows and rows inside the review line are told apart. */
  attribute: 'data-discovered-worktree' | 'data-review-worktree';
  onAdopt: DiscoveredWorktreeActions['onAdopt'];
}) {
  return (
    <div
      {...{ [attribute]: worktree.path }}
      data-repo-id={repoId}
      title={worktree.path}
      className="flex items-center gap-2 rounded-md px-2 py-1 text-list-meta text-text-muted"
    >
      <FolderGit2 className="h-3 w-3 shrink-0 text-text-passive" />
      <span className="min-w-0 flex-1 truncate">
        {worktree.branch ?? `${folderName(worktree.path)} (detached)`}
      </span>
      <span className="shrink-0 text-text-passive">{SOURCE_LABEL[worktree.source]}</span>
      <button type="button" className={smallButton} onClick={() => onAdopt(repoId, worktree)}>
        Adopt
      </button>
    </div>
  );
}

/**
 * Under a repository's header in the left rail (plan §Phase 3 slice 6): its
 * checkouts from shown sources, each with Adopt, then one line counting the
 * hidden ones — "Review N worktrees" — which opens them for Adopt or goes
 * away with "Hide for this repo".
 */
export function DiscoveredWorktreeRows({
  sources,
  failure,
  actions,
  onArchiveRepo,
}: {
  sources: RepoWorktreeSources | undefined;
  failure: RepoWorktreeSourcesFailure | undefined;
  actions: DiscoveredWorktreeActions;
  /** The repository menu's Archive, offered when the repository's folder is gone. */
  onArchiveRepo: (repoId: string) => void;
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  if (failure?.folderMissing) {
    return (
      <div
        data-repo-folder-missing={failure.repoId}
        title={failure.message}
        className="flex items-center gap-2 px-2 py-1 text-tiny tracking-tiny text-status-err"
      >
        {/* The rail is too narrow for the path; the reason leads, the path is the tooltip. */}
        <span className="min-w-0 flex-1 truncate">Folder no longer exists</span>
        <button type="button" className={smallButton} onClick={() => onArchiveRepo(failure.repoId)}>
          Archive repository
        </button>
      </div>
    );
  }
  if (failure) {
    return (
      <p className="px-2 py-1 text-tiny tracking-tiny text-status-err">
        Could not read this repository’s worktrees: {failure.message}
      </p>
    );
  }
  if (!sources) return null;
  const { repoId, listed, review } = sources;
  const reviewLine = describeWorktreeReviewLine(review.length);

  return (
    <div className="flex flex-col">
      {listed.map((worktree) => (
        <DiscoveredRow
          key={worktree.path}
          repoId={repoId}
          worktree={worktree}
          attribute="data-discovered-worktree"
          onAdopt={actions.onAdopt}
        />
      ))}
      {reviewLine && (
        <div data-worktree-review={repoId} className="flex flex-col">
          <div className="flex items-center gap-1 px-2 py-1 text-list-meta text-text-passive">
            <button
              type="button"
              aria-expanded={reviewOpen}
              onClick={() => setReviewOpen((open) => !open)}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 hover:text-text-muted"
            >
              <ChevronDown
                className={cn('h-3 w-3 shrink-0 transition-transform', !reviewOpen && '-rotate-90')}
              />
              <span className="truncate">{reviewLine}</span>
            </button>
            <button
              type="button"
              className={smallButton}
              onClick={() => actions.onHideReview(repoId)}
            >
              Hide for this repo
            </button>
          </div>
          {reviewOpen &&
            review.map((worktree) => (
              <DiscoveredRow
                key={worktree.path}
                repoId={repoId}
                worktree={worktree}
                attribute="data-review-worktree"
                onAdopt={actions.onAdopt}
              />
            ))}
        </div>
      )}
    </div>
  );
}
