import { useState } from 'react';
import type { BranchPick, PullRequestPick } from '@shared/create-from';
import type { Issue } from '@shared/tasks';
import { Input } from '@renderer/lib/ui/input';
import { cn } from '@renderer/utils/utils';
import { describeBranchHolder, type CreateFromPick } from './create-from-pick';
import { PROVIDER_LABELS, type TabView } from './create-from-tabs';
import { useBranchesTab, useIssuesTab, usePullRequestsTab } from './use-create-from-sources';

type Tab = 'issues' | 'pull_requests' | 'branches';

const TABS: { id: Tab; label: string; placeholder: string }[] = [
  { id: 'issues', label: 'Issues', placeholder: 'Search issues' },
  { id: 'pull_requests', label: 'Pull requests', placeholder: 'Search pull requests' },
  { id: 'branches', label: 'Branches', placeholder: 'Search branches' },
];

const NOTE = 'px-2 py-3 text-tiny tracking-tiny';

function Row({
  primary,
  secondary,
  muted,
  onPick,
}: {
  primary: string;
  secondary: string | null;
  muted?: boolean;
  onPick: () => void;
}) {
  return (
    <div
      role="option"
      aria-selected={false}
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onPick();
        }
      }}
      className="flex cursor-pointer flex-col rounded-md px-2 py-1.5 outline-none hover:bg-surface-hover focus-visible:bg-surface-hover"
    >
      <span
        className={cn('truncate text-body tracking-body', muted ? 'text-text-muted' : 'text-text')}
      >
        {primary}
      </span>
      {secondary && (
        <span className="truncate text-tiny tracking-tiny text-text-passive">{secondary}</span>
      )}
    </div>
  );
}

function TabRows<T>({
  view,
  renderRow,
}: {
  view: TabView<T>;
  renderRow: (row: T, index: number) => React.ReactNode;
}) {
  switch (view.status) {
    case 'loading':
      return (
        <p role="status" className={`${NOTE} text-text-passive`}>
          Loading…
        </p>
      );
    case 'empty':
      return view.message ? <p className={`${NOTE} text-text-muted`}>{view.message}</p> : null;
    case 'error':
      return <p className={`${NOTE} text-status-err`}>{view.message}</p>;
    case 'rows':
      return (
        <div role="listbox" className="flex flex-col">
          {view.rows.map(renderRow)}
        </div>
      );
  }
}

function describeBranchRow(pick: BranchPick): string | null {
  if (pick.holder) return describeBranchHolder(pick.holder);
  if (pick.remote) return `from ${pick.remote}`;
  return null;
}

function describePullRow(pull: PullRequestPick): string | null {
  const parts = [pull.authorLogin, pull.isDraft ? 'draft' : null].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function IssuesPanel(props: {
  repoId: string;
  query: string;
  onPick: (pick: CreateFromPick) => void;
}) {
  const { view, notices } = useIssuesTab(props.repoId, props.query);
  return (
    <>
      {notices.map((notice) => (
        <p key={notice} className={`${NOTE} text-status-warn`}>
          {notice}
        </p>
      ))}
      <TabRows<Issue>
        view={view}
        renderRow={(issue) => (
          <Row
            key={`${issue.provider}:${issue.identifier}`}
            primary={`${issue.identifier} ${issue.title}`}
            secondary={PROVIDER_LABELS[issue.provider]}
            onPick={() => props.onPick({ kind: 'issue', issue })}
          />
        )}
      />
    </>
  );
}

function PullRequestsPanel(props: {
  repoId: string;
  query: string;
  onPick: (pick: CreateFromPick) => void;
}) {
  const view = usePullRequestsTab(props.repoId, props.query);
  return (
    <TabRows<PullRequestPick>
      view={view}
      renderRow={(pullRequest) => (
        <Row
          key={pullRequest.number}
          primary={`#${pullRequest.number} ${pullRequest.title}`}
          secondary={describePullRow(pullRequest)}
          onPick={() => props.onPick({ kind: 'pull_request', pullRequest })}
        />
      )}
    />
  );
}

function BranchesPanel(props: {
  repoId: string;
  query: string;
  onPick: (pick: CreateFromPick) => void;
}) {
  const view = useBranchesTab(props.repoId, props.query);
  return (
    <TabRows<BranchPick>
      view={view}
      renderRow={(branch) => (
        <Row
          key={branch.name}
          primary={branch.name}
          secondary={describeBranchRow(branch)}
          // Listed, never hidden: picking it says why it can't be reused.
          muted={branch.holder !== null}
          onPick={() => props.onPick({ kind: 'branch', branch })}
        />
      )}
    />
  );
}

/**
 * The chip's text. Branch off is named for the action that made it: the
 * preview under the field already reads "New branch from <branch>".
 */
function describePick(pick: CreateFromPick): string {
  switch (pick.kind) {
    case 'issue':
      return `From ${pick.issue.identifier} ${pick.issue.title}`;
    case 'pull_request':
      return `From PR #${pick.pullRequest.number} ${pick.pullRequest.title}`;
    case 'branch':
      return `From Branch ${pick.branch.name}`;
    case 'branch_off':
      return `Branch off ${pick.branch}`;
  }
}

/** The Name field while a pick stands in for it; Clear goes back to typing. */
export function PickChip({ pick, onClear }: { pick: CreateFromPick; onClear: () => void }) {
  return (
    <div className="flex h-8 items-center gap-2 rounded-md border border-border px-2.5">
      <span className="min-w-0 flex-1 truncate text-body tracking-body text-text">
        {describePick(pick)}
      </span>
      <button
        type="button"
        onClick={onClear}
        className="text-tiny tracking-tiny text-text-muted transition-colors hover:text-text"
      >
        Clear
      </button>
    </div>
  );
}

/**
 * Create from… (plan §Phase 3 slice 2): the selected repository's issues
 * (every connected tracker), open pull requests and branches, each searchable.
 * A pick replaces what the Name field would have resolved to.
 */
export function CreateFromPicker({
  repoId,
  onPick,
}: {
  repoId: string | null;
  onPick: (pick: CreateFromPick) => void;
}) {
  const [tab, setTab] = useState<Tab>('issues');
  const [queries, setQueries] = useState<Record<Tab, string>>({
    issues: '',
    pull_requests: '',
    branches: '',
  });
  const active = TABS.find((entry) => entry.id === tab)!;
  const query = queries[tab];

  return (
    <div className="mt-2 rounded-md border border-border bg-surface-raised p-2">
      <div role="tablist" aria-label="Create from" className="mb-2 flex gap-1">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={entry.id === tab}
            onClick={() => setTab(entry.id)}
            // No colour transition: the panel switches at once, and a fading
            // pill left the previous tab looking selected (devstation-10g).
            className={cn(
              'rounded-md px-2 py-1 text-tiny tracking-tiny',
              entry.id === tab
                ? 'bg-surface-active text-text'
                : 'text-text-muted hover:bg-surface-hover hover:text-text'
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={active.label}>
        <Input
          value={query}
          onChange={(event) => setQueries((prev) => ({ ...prev, [tab]: event.target.value }))}
          placeholder={active.placeholder}
        />
        <div className="mt-1 max-h-60 overflow-y-auto">
          {!repoId ? (
            <p className={`${NOTE} text-text-muted`}>Choose a repository first.</p>
          ) : tab === 'issues' ? (
            <IssuesPanel repoId={repoId} query={query} onPick={onPick} />
          ) : tab === 'pull_requests' ? (
            <PullRequestsPanel repoId={repoId} query={query} onPick={onPick} />
          ) : (
            <BranchesPanel repoId={repoId} query={query} onPick={onPick} />
          )}
        </div>
      </div>
    </div>
  );
}
