import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from 'cmdk';
import { Circle, FileText, GitPullRequest, MessageSquare, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { WorkItemRow } from '@main/db/schema-work-items';
import { artifactPathTab } from '@renderer/features/work-list/center-tab';
import { openCenterTab } from '@renderer/features/work-list/center-tabs-store';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { cn } from '@renderer/utils/utils';
import { usePaletteCommands } from './use-palette-commands';
import { usePaletteSearch, type EntityFilter } from './use-palette-search';

const GROUP_HEADING = '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5';

const ITEM_CLASS =
  'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-list-row text-text transition-colors duration-[120ms] ease-out data-[selected=true]:bg-surface-raised data-[selected=true]:shadow-[inset_2px_0_0_var(--color-status-running)]';

const ITEM_CLASS_GREEN =
  'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-list-row text-text font-medium transition-colors duration-[120ms] ease-out data-[selected=true]:bg-surface-raised data-[selected=true]:shadow-[inset_2px_0_0_var(--action-bg)]';

const FILTER_CHIP =
  'rounded-full px-2 py-0.5 text-tiny tracking-tiny font-medium transition-colors';

const FILTERS: Array<{ id: EntityFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'work-items', label: 'Work Items' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'chat', label: 'Chat' },
  { id: 'prs', label: 'PRs' },
];

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { navigate } = useNavigate();
  const groups = usePaletteCommands();
  const [workItems, setWorkItems] = useState<WorkItemRow[]>([]);
  const [workItemsError, setWorkItemsError] = useState<string | null>(null);

  const {
    filter,
    query,
    artifactResults,
    chatResults,
    prResults,
    searchError,
    changeQuery,
    changeFilter,
    reset,
  } = usePaletteSearch(open);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) reset();
      onOpenChange(next);
    },
    [onOpenChange, reset]
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    rpc.workItems.getAll().then(
      (result) => {
        if (cancelled) return;
        if (result.success) {
          setWorkItems(result.data.items);
          setWorkItemsError(null);
        } else {
          setWorkItemsError('Could not load work items.');
        }
      },
      (error: unknown) => {
        if (cancelled) return;
        setWorkItemsError(error instanceof Error ? error.message : 'Could not load work items.');
      }
    );
    return () => {
      cancelled = true;
    };
  }, [open]);

  const run = useCallback(
    (action: () => void | Promise<void>) => {
      void action();
      handleOpenChange(false);
    },
    [handleOpenChange]
  );

  const showCommands = filter === 'all';
  const showWorkItems = filter === 'all' || filter === 'work-items';
  const showArtifacts = (filter === 'all' || filter === 'artifacts') && artifactResults.length > 0;
  const showChat = (filter === 'all' || filter === 'chat') && chatResults.length > 0;
  const showPrs = (filter === 'all' || filter === 'prs') && prResults.length > 0;
  const failure = workItemsError ?? searchError;

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      label="Command Palette"
      overlayClassName="fixed inset-0 z-50 bg-scrim duration-100 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
      contentClassName="fixed top-1/2 left-1/2 z-50 w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 outline-none duration-100 sm:max-w-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
    >
      <div className="floating-surface flex flex-col overflow-hidden rounded-lg">
        <div className="flex items-center gap-2 border-b border-border/30 px-3">
          <Search className="h-4 w-4 shrink-0 text-text-passive" />
          <CommandInput
            placeholder="Type a command or search..."
            value={query}
            onValueChange={changeQuery}
            className="h-11 w-full border-none bg-transparent text-body tracking-body text-text outline-none placeholder:text-text-passive"
          />
        </div>

        {/* Entity filter chips */}
        <div className="flex gap-1 border-b border-border px-3 py-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => changeFilter(f.id)}
              className={cn(
                FILTER_CHIP,
                filter === f.id
                  ? 'bg-border-strong text-text'
                  : 'bg-surface-inset text-text-passive hover:text-text-muted'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {failure && (
          <div className="border-b border-border px-3 py-1.5 text-tiny tracking-tiny text-status-err">
            {failure}
          </div>
        )}

        <CommandList className="max-h-[380px] overflow-y-auto p-2">
          <CommandEmpty className="py-6 text-center text-body tracking-body text-text-passive">
            No results found.
          </CommandEmpty>

          {/* Work Items */}
          {showWorkItems && workItems.length > 0 && (
            <>
              <CommandGroup heading="Work Items" className={GROUP_HEADING}>
                {workItems.slice(0, 8).map((item) => (
                  <CommandItem
                    key={`wi-${item.id}`}
                    value={`${item.name} ${item.branchName ?? ''} ${item.repoAlias ?? ''}`}
                    keywords={[item.status, item.repoAlias ?? '']}
                    onSelect={() =>
                      run(() => {
                        navigate('work-list', { workItemId: item.id });
                      })
                    }
                    className={ITEM_CLASS}
                  >
                    <Circle
                      className={`h-3 w-3 shrink-0 ${
                        item.status === 'done'
                          ? 'text-status-ok'
                          : item.status === 'urgent'
                            ? 'text-status-warn'
                            : 'text-text-passive'
                      }`}
                    />
                    <span className="flex-1 truncate">{item.name}</span>
                    {item.repoAlias && (
                      <span className="shrink-0 rounded-xs bg-surface-inset px-1 py-0 font-mono text-list-meta text-text-passive">
                        {item.repoAlias}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator className="mx-2 my-1 h-px bg-border" />
            </>
          )}

          {/* Artifacts */}
          {showArtifacts && (
            <>
              <CommandGroup heading="Artifacts" className={GROUP_HEADING}>
                {artifactResults.map((artifact) => (
                  <CommandItem
                    key={`art-${artifact.id}`}
                    value={`${artifact.name} ${artifact.workItemName ?? ''}`}
                    onSelect={() =>
                      run(() => {
                        openCenterTab(
                          artifact.workItemId,
                          artifactPathTab(artifact.id, artifact.name)
                        );
                        navigate('work-list', { workItemId: artifact.workItemId });
                      })
                    }
                    className={ITEM_CLASS}
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                    <span className="flex-1 truncate">{artifact.name}</span>
                    {artifact.workItemName && (
                      <span className="shrink-0 truncate rounded-xs bg-surface-inset px-1 py-0 text-list-meta text-text-passive">
                        {artifact.workItemName}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator className="mx-2 my-1 h-px bg-border" />
            </>
          )}

          {/* Chat Messages */}
          {showChat && (
            <>
              <CommandGroup heading="Chat" className={GROUP_HEADING}>
                {chatResults.map((msg) => {
                  const preview =
                    msg.content.length > 80 ? msg.content.slice(0, 80) + '...' : msg.content;
                  return (
                    <CommandItem
                      key={`chat-${msg.id}`}
                      value={`${msg.content} ${msg.workItemName ?? ''}`}
                      onSelect={() =>
                        run(() => {
                          navigate('work-list', { workItemId: msg.workItemId });
                        })
                      }
                      className={ITEM_CLASS}
                    >
                      <MessageSquare className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-list-row">{preview}</span>
                        <span className="truncate text-list-meta text-text-passive">
                          {msg.senderName ?? msg.senderType}
                          {msg.workItemName ? ` · ${msg.workItemName}` : ''}
                        </span>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              <CommandSeparator className="mx-2 my-1 h-px bg-border" />
            </>
          )}

          {/* Pull Requests */}
          {showPrs && (
            <>
              <CommandGroup heading="Pull Requests" className={GROUP_HEADING}>
                {prResults.map((pr) => (
                  <CommandItem
                    key={`pr-${pr.url}`}
                    value={`${pr.title} ${pr.identifier ?? ''} ${pr.headRefName}`}
                    onSelect={() =>
                      run(() => {
                        void rpc.app.openExternal(pr.url);
                      })
                    }
                    className={ITEM_CLASS}
                  >
                    <GitPullRequest
                      className={`h-3.5 w-3.5 shrink-0 ${
                        pr.status === 'merged'
                          ? 'text-status-merged'
                          : pr.status === 'open'
                            ? 'text-status-ok'
                            : 'text-text-passive'
                      }`}
                    />
                    <span className="flex-1 truncate">{pr.title}</span>
                    {pr.identifier && (
                      <span className="shrink-0 font-mono text-list-meta text-text-passive">
                        {pr.identifier}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator className="mx-2 my-1 h-px bg-border" />
            </>
          )}

          {/* Static command groups */}
          {showCommands &&
            groups.map((group, gi) => (
              <div key={group.heading}>
                {gi > 0 && <CommandSeparator className="mx-2 my-1 h-px bg-border" />}
                <CommandGroup heading={group.heading} className={GROUP_HEADING}>
                  {group.commands.map((cmd) => (
                    <CommandItem
                      key={cmd.id}
                      value={cmd.label}
                      keywords={cmd.keywords}
                      onSelect={() => run(cmd.action)}
                      className={cmd.green ? ITEM_CLASS_GREEN : ITEM_CLASS}
                    >
                      <cmd.icon
                        className={`h-4 w-4 shrink-0 ${cmd.green ? 'text-text' : 'text-text-muted'}`}
                      />
                      <span className="flex-1">{cmd.label}</span>
                      {cmd.shortcut && (
                        <kbd className="rounded border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-list-meta text-text-passive">
                          {cmd.shortcut}
                        </kbd>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </div>
            ))}
        </CommandList>
      </div>
    </CommandDialog>
  );
}
