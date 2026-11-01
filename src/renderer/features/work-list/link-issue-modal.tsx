import { Loader2, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { IssueProviderType } from '@shared/issue-providers';
import type { Issue } from '@shared/tasks';
import { rpc } from '@renderer/lib/ipc';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { describeThrownFailure } from './describe-action-failure';

const PROVIDERS: { id: IssueProviderType; label: string }[] = [
  { id: 'github', label: 'GitHub' },
  { id: 'linear', label: 'Linear' },
  { id: 'jira', label: 'Jira' },
];

export interface LinkIssueResult {
  ticketId: string;
  ticketProvider: string;
  ticketUrl: string;
}

export function LinkIssueModal({
  workItemId,
  onSuccess,
  onClose,
}: BaseModalProps<LinkIssueResult> & { workItemId: string }) {
  const [provider, setProvider] = useState<IssueProviderType>('github');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Issue[]>([]);
  const [searching, setSearching] = useState(false);
  const [connectedProviders, setConnectedProviders] = useState<IssueProviderType[]>([]);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  // A swallowed connection probe left every provider marked "(not connected)"
  // with no way to tell a real disconnection from a failed check.
  useEffect(() => {
    rpc.issues
      .checkAllConnections()
      .then((statusMap) => {
        const connected = Object.entries(statusMap)
          .filter(([, status]) => status.connected)
          .map(([key]) => key as IssueProviderType);
        setConnectedProviders(connected);
        setConnectionsError(null);
        if (connected.length > 0 && !connected.includes(provider)) {
          setProvider(connected[0]);
        }
      })
      .catch((e: unknown) =>
        setConnectionsError(describeThrownFailure('Check issue connections', e))
      );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const result = await rpc.issues.searchIssues(provider, { searchTerm: query.trim() });
      if (result.success) {
        setResults(result.issues);
        return;
      }
      setResults([]);
      setSearchError(`Search failed: ${result.error}`);
    } catch (e) {
      setResults([]);
      setSearchError(describeThrownFailure('Search', e));
    } finally {
      setSearching(false);
    }
  }, [provider, query]);

  // A failed write must never report success: the modal stays open with the
  // reason so the link can be retried, and onSuccess fires only once the
  // ticket row actually exists.
  const handleSelect = useCallback(
    async (issue: Issue) => {
      if (linking) return;
      setLinking(true);
      setLinkError(null);
      try {
        const result = await rpc.workItemTickets.addTicket({
          workItemId,
          ticketId: issue.identifier,
          ticketProvider: issue.provider,
          ticketUrl: issue.url,
        });
        if (!result.success) {
          setLinkError(`Could not link ${issue.identifier}: ${result.error}`);
          return;
        }
        onSuccess({
          ticketId: issue.identifier,
          ticketProvider: issue.provider,
          ticketUrl: issue.url,
        });
      } catch (e) {
        setLinkError(`Could not link ${issue.identifier}: ${(e as Error).message}`);
      } finally {
        setLinking(false);
      }
    },
    [workItemId, onSuccess, linking]
  );

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-title font-semibold tracking-title text-text">Link Issue</h2>
        <button
          onClick={onClose}
          className="cursor-pointer rounded-xs border-none bg-transparent px-2 py-1 text-tiny tracking-tiny text-text-passive hover:text-text-muted"
        >
          Cancel
        </button>
      </div>

      {connectionsError && (
        <p role="alert" className="text-tiny tracking-tiny text-status-err">
          {connectionsError} — provider availability below may be wrong.
        </p>
      )}

      <div className="flex items-center gap-2">
        <select
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value as IssueProviderType);
            setResults([]);
          }}
          className="cursor-pointer rounded-xs border border-border bg-surface px-2 py-1.5 text-tiny tracking-tiny text-text outline-none"
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id} disabled={!connectedProviders.includes(p.id)}>
              {p.label}
              {!connectedProviders.includes(p.id) ? ' (not connected)' : ''}
            </option>
          ))}
        </select>
        <div className="relative flex flex-1">
          <Search className="absolute top-1/2 left-2 h-3 w-3 -translate-y-1/2 text-text-passive" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleSearch();
              }
            }}
            placeholder="Search issues…"
            className="w-full rounded-xs border border-border bg-surface py-1.5 pr-2 pl-7 text-tiny tracking-tiny text-text outline-none placeholder:text-text-passive focus:border-border-strong"
          />
        </div>
        <button
          onClick={() => void handleSearch()}
          disabled={searching || !query.trim()}
          className="cursor-pointer rounded-xs bg-action-bg px-3 py-1.5 text-tiny tracking-tiny font-medium text-action-fg transition-colors hover:bg-action-bg-hover disabled:cursor-default disabled:bg-surface-hover-solid disabled:text-text-passive"
        >
          {searching ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Search'}
        </button>
      </div>

      <div className="max-h-[280px] overflow-y-auto rounded-xs border border-border">
        {results.length === 0 ? (
          searchError ? (
            <div
              role="alert"
              className="px-3 py-6 text-center text-tiny tracking-tiny text-status-err"
            >
              {searchError}
            </div>
          ) : (
            <div className="px-3 py-6 text-center text-tiny tracking-tiny text-text-passive">
              {searching ? 'Searching…' : 'Search for an issue to link'}
            </div>
          )
        ) : (
          <div className="flex flex-col">
            {results.map((issue) => (
              <button
                key={`${issue.provider}-${issue.identifier}`}
                onClick={() => void handleSelect(issue)}
                disabled={linking}
                className="flex cursor-pointer items-start gap-2 border-b border-border bg-transparent px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-surface-hover disabled:cursor-default disabled:text-text-disabled"
              >
                <span className="shrink-0 rounded-xs bg-surface-hover-solid px-1 py-0 font-mono text-micro tracking-micro font-medium text-text-muted">
                  {issue.identifier}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                  <span className="truncate text-tiny tracking-tiny font-medium text-text">
                    {issue.title}
                  </span>
                  {issue.status && (
                    <span className="text-micro tracking-micro text-text-passive">
                      {issue.status}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {linkError && <p className="text-tiny tracking-tiny text-status-err">{linkError}</p>}
    </div>
  );
}
