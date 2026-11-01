import { Check, ChevronDown, FolderOpen } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RepoRow } from '@main/db/schema-work-items';
import { notifyReposChanged } from '@renderer/features/settings/create-repository';
import { rpc } from '@renderer/lib/ipc';
import { cn } from '@renderer/utils/utils';
import { describeRpcFailure, describeThrownFailure } from './describe-action-failure';

/**
 * What the control needs off a repo row: the identity it lists and the working
 * tree it names. Deliberately not the whole `RepoRow` — `repos.getAll` returns
 * `icon` parsed into a `RepoIcon`, which no picker reads.
 */
export type RepoPickerRow = Pick<RepoRow, 'id' | 'path' | 'alias'>;

/**
 * The repository control shared by every "create a work item" surface. Both
 * surfaces used to carry their own copy, which is how the dashboard composer
 * ended up with no repository control at all when the list was empty — a fresh
 * install created work items with no repository and never said so.
 */

/**
 * Adds a repository from the native folder picker.
 *
 * The trust decision is requested at add-time rather than deferred to submit:
 * the question names a folder, and it is answerable while the user is still
 * looking at the one they just picked. Already-decided repositories return
 * their standing answer without prompting, so the use-time request each create
 * path still makes is not a second dialog.
 */
export function useAddRepoFromFolder({
  onRepoAdded,
  onError,
}: {
  onRepoAdded: (repo: RepoRow) => void;
  onError: (message: string) => void;
}): () => void {
  return useCallback(() => {
    void (async () => {
      try {
        const selected = await rpc.app.openSelectDirectoryDialog({
          title: 'Select repository folder',
          message: 'Choose a git repository',
        });
        if (!selected) return;

        const segments = selected.replace(/\\/g, '/').split('/');
        const alias = segments[segments.length - 1] ?? 'repo';
        const result = await rpc.repos.create({ path: selected, alias });
        if (!result.success) {
          onError(describeRpcFailure('Add repository', result.error));
          return;
        }

        onRepoAdded(result.data.repo);
        // Keeps the other create surface and the settings list in step with a
        // repo added from here.
        notifyReposChanged();
      } catch (e) {
        onError(describeThrownFailure('Add repository', e));
      }
    })();
  }, [onRepoAdded, onError]);
}

/**
 * The repository picker itself.
 *
 * There is deliberately no "no repository" option: `createWorkItem` resolves
 * the work item's `repoPath` from the selected repo and returns `no_repo` when
 * it cannot (`work-item-crud.ts:58`), so offering "none" would be offering an
 * option that always ends in "A repository is required".
 */
export function RepoSelector({
  repos,
  selectedRepoId,
  onSelect,
  onBrowse,
  placement,
}: {
  repos: RepoPickerRow[];
  selectedRepoId: string | null;
  onSelect: (id: string) => void;
  onBrowse: () => void;
  /** Which way the menu opens away from the trigger. */
  placement: 'above' | 'below';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selectedRepo = repos.find((r) => r.id === selectedRepoId);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Nothing to pick from yet: the control still has to exist. Without it a
  // fresh install offers no way to satisfy a requirement it will then fail on
  // — the dashboard composer used to hide this whole block behind
  // `repos.length > 0`, so "A repository is required" arrived with nothing on
  // screen that could add one.
  if (repos.length === 0) {
    return (
      <button
        type="button"
        onClick={onBrowse}
        className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-tiny tracking-tiny text-text-muted transition-colors hover:border-text-passive hover:text-text"
      >
        <FolderOpen className="h-3 w-3" />
        Add repository
      </button>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={selectedRepo ? selectedRepo.path : 'Choose a repository'}
        className="flex items-center gap-1.5 rounded-md border border-border bg-transparent px-2 py-1 font-mono text-tiny tracking-tiny text-text-muted outline-none transition-colors hover:border-text-passive"
      >
        <FolderOpen className="h-3 w-3 shrink-0" />
        <span className="max-w-[120px] truncate">{selectedRepo?.alias ?? 'Select repo'}</span>
        <ChevronDown className="h-3 w-3 shrink-0" />
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            'floating-surface absolute left-0 z-50 max-h-[240px] w-[220px] overflow-y-auto rounded-lg py-1',
            placement === 'above' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          )}
        >
          {repos.map((r) => (
            <RepoOption
              key={r.id}
              label={r.alias}
              title={r.path}
              selected={r.id === selectedRepoId}
              onClick={() => {
                onSelect(r.id);
                setOpen(false);
              }}
            />
          ))}
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onBrowse();
            }}
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-tiny tracking-tiny text-text-muted transition-colors hover:bg-surface-inset"
          >
            <FolderOpen className="h-3.5 w-3.5 shrink-0" />
            Browse folder...
          </button>
        </div>
      )}
    </div>
  );
}

function RepoOption({
  label,
  title,
  selected,
  onClick,
}: {
  label: string;
  title?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      title={title}
      onClick={onClick}
      className={cn(
        'flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-tiny tracking-tiny transition-colors hover:bg-surface-inset',
        selected ? 'text-text' : 'text-text-muted'
      )}
    >
      <Check className={cn('h-3.5 w-3.5 shrink-0', selected ? 'opacity-100' : 'opacity-0')} />
      <span className="truncate">{label}</span>
    </button>
  );
}
