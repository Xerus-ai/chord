import { useCallback, useEffect, useRef, useState } from 'react';
import { rpc } from '@renderer/lib/ipc';

export type EntityFilter = 'all' | 'work-items' | 'artifacts' | 'chat' | 'prs';

export interface ArtifactResult {
  id: string;
  workItemId: string;
  name: string;
  type: string;
  status: string;
  workItemName: string | null;
}

export interface ChatResult {
  id: string;
  workItemId: string;
  content: string;
  senderName: string | null;
  senderType: string;
  createdAt: number;
  workItemName: string | null;
}

export interface PrResult {
  url: string;
  title: string;
  identifier: string | null;
  status: string;
  isDraft: number | null;
  headRefName: string;
}

const DEBOUNCE_MS = 200;
const MIN_QUERY_LENGTH = 2;

function describe(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function usePaletteSearch(open: boolean) {
  const [filter, setFilter] = useState<EntityFilter>('all');
  const [query, setQuery] = useState('');
  const [artifactResults, setArtifactResults] = useState<ArtifactResult[]>([]);
  const [chatResults, setChatResults] = useState<ChatResult[]>([]);
  const [prResults, setPrResults] = useState<PrResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Bumped whenever the query or filter changes: a slow response for an older
  // keystroke must not overwrite the results the user is looking at.
  const requestSeqRef = useRef(0);

  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  const clearResults = useCallback(() => {
    setArtifactResults([]);
    setChatResults([]);
    setPrResults([]);
  }, []);

  const runSearch = useCallback(
    (q: string, f: EntityFilter) => {
      clearTimeout(debounceRef.current);
      requestSeqRef.current += 1;

      if (!open || q.length < MIN_QUERY_LENGTH) {
        clearResults();
        setSearchError(null);
        return;
      }

      debounceRef.current = setTimeout(() => {
        const seq = requestSeqRef.current;
        const isStale = () => seq !== requestSeqRef.current;
        setSearchError(null);

        if (f === 'all' || f === 'artifacts') {
          rpc.artifacts.searchAll({ query: q, limit: 8 }).then(
            (r) => {
              if (isStale()) return;
              if (r.success) setArtifactResults(r.data.artifacts as ArtifactResult[]);
              else setSearchError('Artifact search failed');
            },
            (error: unknown) => {
              if (!isStale()) setSearchError(describe(error, 'Artifact search failed'));
            }
          );
        } else {
          setArtifactResults([]);
        }

        if (f === 'all' || f === 'chat') {
          rpc.chatMessages.searchAll({ query: q, limit: 8 }).then(
            (r) => {
              if (isStale()) return;
              if (r.success) setChatResults(r.data.messages as ChatResult[]);
              else setSearchError('Chat search failed');
            },
            (error: unknown) => {
              if (!isStale()) setSearchError(describe(error, 'Chat search failed'));
            }
          );
        } else {
          setChatResults([]);
        }

        if (f === 'all' || f === 'prs') {
          rpc.pullRequests.searchAll({ query: q, limit: 8 }).then(
            (r) => {
              if (isStale()) return;
              if (r.success) setPrResults(r.data.prs as PrResult[]);
              else setSearchError('Pull request search failed');
            },
            (error: unknown) => {
              if (!isStale()) setSearchError(describe(error, 'Pull request search failed'));
            }
          );
        } else {
          setPrResults([]);
        }
      }, DEBOUNCE_MS);
    },
    [open, clearResults]
  );

  const changeQuery = useCallback(
    (q: string) => {
      setQuery(q);
      runSearch(q, filter);
    },
    [filter, runSearch]
  );

  const changeFilter = useCallback(
    (f: EntityFilter) => {
      setFilter(f);
      runSearch(query, f);
    },
    [query, runSearch]
  );

  const reset = useCallback(() => {
    clearTimeout(debounceRef.current);
    requestSeqRef.current += 1;
    setFilter('all');
    setQuery('');
    setSearchError(null);
    clearResults();
  }, [clearResults]);

  return {
    filter,
    query,
    artifactResults,
    chatResults,
    prResults,
    searchError,
    changeQuery,
    changeFilter,
    reset,
  };
}
