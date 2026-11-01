import { Search, X } from 'lucide-react';
import { SegmentedControl } from '@renderer/lib/ui/segmented-control';

export type SearchMode = 'names' | 'contents';

/**
 * The Explorer's search: Names filters the worktree's paths in the renderer,
 * Contents asks the worktree to grep. Two modes rather than one blended
 * result, because they answer different questions and only one of them costs a
 * subprocess per keystroke.
 */
export function SearchStrip({
  mode,
  onModeChange,
  query,
  onQueryChange,
}: {
  mode: SearchMode;
  onModeChange: (mode: SearchMode) => void;
  query: string;
  onQueryChange: (query: string) => void;
}) {
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-b border-border-subtle px-3 py-2">
      <SegmentedControl<SearchMode>
        size="xs"
        ariaLabel="Search mode"
        value={mode}
        onChange={onModeChange}
        options={[
          { value: 'names', label: 'Names' },
          { value: 'contents', label: 'Contents' },
        ]}
      />
      <div className="flex items-center gap-1.5 rounded-xs border border-border bg-surface px-2 py-1 focus-within:border-border-strong">
        <Search className="size-icon-xs shrink-0 text-text-passive" />
        <input
          type="text"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onQueryChange('');
          }}
          placeholder={mode === 'names' ? 'Find a file' : 'Search file contents'}
          aria-label={mode === 'names' ? 'Find a file by name' : 'Search file contents'}
          className="min-w-0 flex-1 border-none bg-transparent text-tiny tracking-tiny text-text outline-none placeholder:text-text-passive"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onQueryChange('')}
            className="flex shrink-0 cursor-pointer items-center justify-center rounded-xs border-none bg-transparent p-0 text-text-passive hover:text-text-muted"
          >
            <X className="size-icon-xs" />
          </button>
        )}
      </div>
    </div>
  );
}
