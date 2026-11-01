import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { isLiveDocumentType, type ConfluencePublicationStatus } from '@shared/confluence';
import {
  confluencePublicationChannel,
  type ConfluencePublicationUpdate,
} from '@shared/events/confluenceEvents';
import type { ArtifactType } from '@shared/stream-items';
import { events, rpc } from '@renderer/lib/ipc';

/**
 * Confluence in the renderer (plan 2026-09-23 §4 P5): the device's
 * connection, its spaces, and one artifact's publication. All of it is main
 * process data, so it lives in the query cache.
 */

const CONNECTION_KEY = ['confluence', 'connection'] as const;
const SPACES_KEY = ['confluence', 'spaces'] as const;
/** A document's status is re-read once typing pauses, not on every keystroke. */
const DOCUMENT_STATUS_DEBOUNCE_MS = 1500;
/** Picks up edits made in Confluence while the artifact stays open. */
const STATUS_REFRESH_MS = 30_000;

export function useConfluenceConnection() {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: CONNECTION_KEY,
    queryFn: () => rpc.confluence.checkConnection(),
    staleTime: 30_000,
  });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: CONNECTION_KEY });
    void queryClient.invalidateQueries({ queryKey: SPACES_KEY });
  };
  const connect = useMutation({
    mutationFn: async (credentials: { siteUrl: string; email: string; token: string }) => {
      const result = await rpc.confluence.saveCredentials(credentials);
      if (!result.success) throw new Error(result.error);
      return result;
    },
    onSettled: invalidate,
  });
  const disconnect = useMutation({
    mutationFn: () => rpc.confluence.clearCredentials(),
    onSettled: invalidate,
  });
  return { status: status.data, isLoading: status.isLoading, connect, disconnect };
}

export function useConfluenceSpaces(enabled: boolean) {
  return useQuery({
    queryKey: SPACES_KEY,
    enabled,
    queryFn: async () => {
      const result = await rpc.confluence.listSpaces();
      if (!result.success) throw new Error(result.error.message);
      return result.data.spaces;
    },
  });
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** Cheap, stable key for content that can be large (djb2). */
function hashContent(content: string): string {
  let hash = 5381;
  for (let i = 0; i < content.length; i++) hash = ((hash << 5) + hash + content.charCodeAt(i)) | 0;
  return `${content.length}:${hash >>> 0}`;
}

export type PublishOutcome =
  | { kind: 'published'; status: ConfluencePublicationStatus }
  | { kind: 'edited_in_confluence'; status: ConfluencePublicationStatus };

/**
 * One artifact's Confluence status and its publish action. A document is
 * compared and published by its live content (what the editor holds); other
 * formats by their file, which main reads itself.
 */
export function useConfluencePublication(args: {
  artifactId: string;
  artifactType: ArtifactType | null;
  content: string;
  enabled: boolean;
  /** A publish saved a version: the History tab should re-read. */
  onPublished: () => void;
}) {
  const queryClient = useQueryClient();
  const live = args.artifactType !== null && isLiveDocumentType(args.artifactType);
  const settledContent = useDebouncedValue(args.content, DOCUMENT_STATUS_DEBOUNCE_MS);
  const { artifactId, onPublished } = args;
  const [autoUpdateError, setAutoUpdateError] = useState<string | null>(null);

  const status = useQuery({
    queryKey: ['confluence', 'status', artifactId, hashContent(settledContent)],
    enabled: args.enabled && args.artifactType !== null,
    refetchInterval: STATUS_REFRESH_MS,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const result = await rpc.confluence.getStatus({
        artifactId,
        documentHtml: live ? settledContent : undefined,
      });
      if (!result.success) throw new Error(result.error.message);
      return result.data.status;
    },
  });

  // An automatic update ran in main: re-read, and surface a failure.
  useEffect(
    () =>
      events.on(confluencePublicationChannel, (update: ConfluencePublicationUpdate) => {
        if (update.artifactId !== artifactId) return;
        setAutoUpdateError(update.error ?? null);
        void queryClient.invalidateQueries({ queryKey: ['confluence', 'status', artifactId] });
        if (update.status) onPublished();
      }),
    [artifactId, queryClient, onPublished]
  );

  const publish = useMutation({
    mutationFn: async (options: { overwriteRemoteEdits: boolean }): Promise<PublishOutcome> => {
      const result = await rpc.confluence.publishArtifact({
        artifactId,
        documentHtml: live ? args.content : undefined,
        overwriteRemoteEdits: options.overwriteRemoteEdits,
      });
      if (result.success) return { kind: 'published', status: result.data.status };
      if (result.error.type === 'edited_in_confluence') {
        return { kind: 'edited_in_confluence', status: result.error.status };
      }
      throw new Error(result.error.message);
    },
    onSuccess: (outcome) => {
      setAutoUpdateError(null);
      if (outcome.kind === 'published') onPublished();
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['confluence', 'status', artifactId] });
    },
  });

  return {
    status: status.data,
    statusError: autoUpdateError ?? (status.error ? status.error.message : null),
    isChecking: status.isFetching,
    publish,
  };
}
