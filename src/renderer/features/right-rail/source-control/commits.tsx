import type { Commit } from '@shared/git';
import { openCenterTab } from '@renderer/features/work-list/center-tabs-store';
import { ListRow } from '@renderer/lib/components/list-row';
import { statusDotClass } from '@renderer/lib/status-dot';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { RailEmpty, RailSection, StatusDot } from '../rail-primitives';

/**
 * Recent commits on this worktree's branch. A row opens the commit as a centre
 * tab — the one place a commit's files and diffs are readable — through the
 * centre-tabs store's own API, since the rail never reaches into that layout
 * directly.
 *
 * The dot is push state, the only per-commit signal that changes: unpushed
 * commits are the reason the Push action exists.
 */
export function CommitsSection({
  commits,
  layoutKey,
  worktreeId,
}: {
  commits: Commit[];
  layoutKey: string;
  worktreeId: string;
}) {
  return (
    <RailSection
      sectionId="source-control:commits"
      title="Commits"
      count={commits.length}
      defaultOpen={false}
    >
      {commits.length === 0 ? (
        <RailEmpty>No commits yet</RailEmpty>
      ) : (
        commits.map((commit) => (
          <ListRow
            key={commit.hash}
            leading={
              <StatusDot
                className={statusDotClass(commit.isPushed ? 'neutral' : 'running')}
                label={commit.isPushed ? 'Pushed' : 'Not pushed'}
              />
            }
            title={commit.subject}
            tooltip={commit.subject}
            meta={
              <>
                <span className="font-mono" style={{ fontVariantLigatures: 'none' }}>
                  {commit.hash.slice(0, 7)}
                </span>
                {' · '}
                {commit.author}
                {' · '}
                <RelativeTime value={commit.date} />
              </>
            }
            navigates
            onOpen={() =>
              openCenterTab(
                layoutKey,
                { kind: 'commit', worktreeId, sha: commit.hash },
                { preview: true }
              )
            }
          />
        ))
      )}
    </RailSection>
  );
}
