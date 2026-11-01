import { useMutation, useQueryClient } from '@tanstack/react-query';
import { reportViewWarnings } from '@renderer/features/artifacts/report-view-warnings';
import {
  invalidateWorkItemArtifacts,
  useWorkItemArtifacts,
} from '@renderer/features/artifacts/use-work-item-artifacts';
import { FileIcon } from '@renderer/lib/editor/file-icon';
import { rpc } from '@renderer/lib/ipc';
import { FOCUS_RING } from '@renderer/lib/ui/focus-ring';
import { cn } from '@renderer/utils/utils';
import type { OpenArtifactHandler } from './turn-artifact-chips';
import { describeArtifactPath, type UnpublishedDocument } from './turn-artifacts';

/**
 * Documents the agent wrote this turn and did not publish. The agent decides
 * what is an artifact; these chips are how a person disagrees. "Add to
 * artifacts" creates the artifact and opens it; a file that is an artifact by
 * now — added here, published later, or added elsewhere — reads as added.
 */
export function UnpublishedDocumentChips({
  documents,
  workItemId,
  workspaceRoot,
  onOpenArtifact,
}: {
  documents: UnpublishedDocument[];
  workItemId: string;
  workspaceRoot: string;
  onOpenArtifact?: OpenArtifactHandler;
}) {
  const queryClient = useQueryClient();
  const artifactsQuery = useWorkItemArtifacts(workItemId);

  const addArtifact = useMutation({
    mutationFn: async (document: UnpublishedDocument) => {
      const result = await rpc.artifacts.create({
        workItemId,
        filePath: document.filePath,
        name: document.name,
      });
      // Signed out (no_identity) or a view that did not build (view_build_failed).
      if (!result.success) throw new Error(result.error.message);
      const artifact = result.data.artifact;
      if (!artifact) throw new Error(`Could not add ${document.name} to artifacts.`);
      return { artifact, warnings: result.data.warnings };
    },
    onSuccess: ({ artifact, warnings }) => {
      void invalidateWorkItemArtifacts(queryClient, workItemId);
      onOpenArtifact?.(artifact.id, artifact.name, { preview: true });
      reportViewWarnings(artifact.name, warnings);
    },
    // The message is shown under the chips (addArtifact.error below).
    onError: (error, document) => {
      console.error(`[artifacts] adding ${document.name} failed:`, error);
    },
  });

  if (documents.length === 0) return null;

  const artifactByPath = new Map(
    (artifactsQuery.data ?? []).map((artifact) => [artifact.filePath, artifact])
  );

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {documents.map((document) => {
        const { directory, fileName } = describeArtifactPath(document.filePath, workspaceRoot);
        const existing = artifactByPath.get(document.filePath);
        const isAdding =
          addArtifact.isPending && addArtifact.variables?.filePath === document.filePath;
        return (
          <div
            key={document.filePath}
            title={document.filePath}
            className="flex h-7 max-w-[360px] min-w-0 items-center gap-2 rounded-xl border border-dashed border-border bg-surface pl-2.5 pr-1"
          >
            <span className="flex shrink-0 items-center text-text-passive">
              <FileIcon filename={fileName} size={12} className="h-3 w-3" />
            </span>
            <span
              dir="rtl"
              className="min-w-0 truncate text-tiny tracking-tiny [unicode-bidi:plaintext]"
            >
              <span className="text-text-passive">{directory}</span>
              <span className="text-text-muted">{fileName}</span>
            </span>
            {existing ? (
              <button
                type="button"
                disabled={!onOpenArtifact}
                onClick={() => onOpenArtifact?.(existing.id, existing.name, { preview: true })}
                className={cn(
                  'shrink-0 cursor-pointer rounded-lg px-2 py-0.5 text-tiny tracking-tiny text-text-muted transition-colors hover:bg-surface-inset hover:text-text disabled:cursor-default',
                  FOCUS_RING
                )}
              >
                Added · Open
              </button>
            ) : (
              <button
                type="button"
                disabled={isAdding || artifactsQuery.isLoading}
                onClick={() => addArtifact.mutate(document)}
                className={cn(
                  'shrink-0 cursor-pointer rounded-lg bg-surface-inset px-2 py-0.5 text-tiny tracking-tiny text-text transition-colors hover:bg-surface-raised disabled:cursor-default disabled:text-text-muted',
                  FOCUS_RING
                )}
              >
                {isAdding ? 'Adding…' : 'Add to artifacts'}
              </button>
            )}
          </div>
        );
      })}
      {addArtifact.error && (
        <p className="w-full text-tiny tracking-tiny text-status-err">
          {addArtifact.error.message}
        </p>
      )}
    </div>
  );
}
