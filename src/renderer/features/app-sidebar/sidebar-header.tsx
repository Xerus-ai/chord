import { FolderPlus } from 'lucide-react';
import { SidebarOptionsPopover } from './options-popover';
import type { SidebarOptions } from './sidebar-options-model';
import type { SidebarView } from './sidebar-projection';

const TABS: { view: SidebarView; label: string }[] = [
  { view: 'repo', label: 'Repos' },
  { view: 'status', label: 'Status' },
];

/**
 * The list's heading row — the prototype's `.sec`: an 11px uppercase label,
 * a Repos|Status segmented tab (`.vtab`), then the display options and add
 * repository triggers. New work item and Search live in the top bar / nav
 * rows above, so they are not repeated here.
 */
export function SidebarHeader({
  options,
  repos,
  view,
  onViewChange,
  onOptionsChange,
  onAddRepo,
}: {
  options: SidebarOptions;
  repos: readonly { id: string; label: string }[];
  view: SidebarView;
  onViewChange: (view: SidebarView) => void;
  onOptionsChange: (next: SidebarOptions) => void;
  onAddRepo: () => void;
}) {
  return (
    <div className="mt-2 flex h-8 shrink-0 items-center gap-1.5 px-2">
      <span className="flex-1 truncate pl-2 text-list-meta font-semibold uppercase tracking-list-label text-text-passive">
        Work items
      </span>
      <div
        role="tablist"
        aria-label="Group work items by"
        className="flex items-center rounded-md border border-border bg-surface p-0.5"
      >
        {TABS.map((tab) => (
          <button
            key={tab.view}
            type="button"
            role="tab"
            aria-selected={view === tab.view}
            onClick={() => onViewChange(tab.view)}
            className={
              view === tab.view
                ? 'flex h-5 items-center rounded-sm bg-surface-inset px-2 text-list-meta font-medium leading-none text-text'
                : 'flex h-5 items-center rounded-sm px-2 text-list-meta font-medium leading-none text-text-passive transition-colors hover:text-text'
            }
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <SidebarOptionsPopover options={options} repos={repos} onChange={onOptionsChange} />
        <button
          type="button"
          aria-label="Add repository"
          title="Add repository (a folder that is already a git repository)"
          onClick={onAddRepo}
          className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
        >
          <FolderPlus className="size-icon-sm" strokeWidth={2.25} />
        </button>
      </div>
    </div>
  );
}
