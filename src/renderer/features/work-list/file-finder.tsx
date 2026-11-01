import { CommandDialog, CommandEmpty, CommandInput, CommandItem, CommandList } from 'cmdk';
import { FileText, Search } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { fuzzyMatchFiles } from '@renderer/lib/ui/file-reference';

const ITEM_CLASS =
  'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-body tracking-body text-text transition-colors duration-[120ms] ease-out data-[selected=true]:bg-surface-raised data-[selected=true]:shadow-[inset_2px_0_0_var(--color-status-running)]';

const MAX_RESULTS = 50;

/**
 * ⌘P fuzzy file finder over the work item's repo. Selection opens the file
 * in the file-viewer center tab.
 */
export function FileFinder({
  open,
  onOpenChange,
  files,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: readonly string[];
  onSelect: (filePath: string) => void;
}) {
  const [query, setQuery] = useState('');

  // Query resets in the close transition itself — no state sync in an effect.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) setQuery('');
      onOpenChange(next);
    },
    [onOpenChange]
  );

  const results = useMemo(() => fuzzyMatchFiles(query, files, MAX_RESULTS), [query, files]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      label="Go to File"
      shouldFilter={false}
      overlayClassName="fixed inset-0 z-50 bg-scrim duration-100 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
      contentClassName="fixed top-1/2 left-1/2 z-50 w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 outline-none duration-100 sm:max-w-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
    >
      <div className="floating-surface flex flex-col overflow-hidden rounded-lg">
        <div className="flex items-center gap-2 border-b border-border/30 px-3">
          <Search className="h-4 w-4 shrink-0 text-text-passive" />
          <CommandInput
            placeholder="Go to file..."
            value={query}
            onValueChange={setQuery}
            className="h-11 w-full border-none bg-transparent text-body tracking-body text-text outline-none placeholder:text-text-passive"
          />
        </div>
        <CommandList className="max-h-[380px] overflow-y-auto p-2">
          <CommandEmpty className="py-6 text-center text-body tracking-body text-text-passive">
            No matching files.
          </CommandEmpty>
          {results.map((file) => {
            const idx = file.lastIndexOf('/');
            const dir = idx === -1 ? '' : file.slice(0, idx);
            const name = idx === -1 ? file : file.slice(idx + 1);
            return (
              <CommandItem
                key={file}
                value={file}
                onSelect={() => {
                  onOpenChange(false);
                  onSelect(file);
                }}
                className={ITEM_CLASS}
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-text-passive" />
                <span className="truncate font-mono text-tiny tracking-tiny">{name}</span>
                {dir && (
                  <span className="min-w-0 flex-1 truncate text-right font-mono text-tiny tracking-tiny text-text-passive">
                    {dir}
                  </span>
                )}
              </CommandItem>
            );
          })}
        </CommandList>
      </div>
    </CommandDialog>
  );
}
