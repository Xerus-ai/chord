import { FileText } from 'lucide-react';

/**
 * The child rows of an item that stands for several artifacts shared alone
 * (shared-items step 3, decision 4): one per artifact, each opening it, under
 * the same left hairline as `WorkItemSubrows`.
 */
export function ArtifactSubrows({
  artifacts,
  onOpenArtifact,
}: {
  artifacts: readonly { id: string; name: string }[];
  onOpenArtifact: (artifactId: string) => void;
}) {
  return (
    <div className="ml-3 border-l border-border pl-2">
      {artifacts.map((artifact) => (
        <button
          key={artifact.id}
          type="button"
          onClick={() => onOpenArtifact(artifact.id)}
          className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-surface-hover"
        >
          <FileText className="size-icon-xs shrink-0 text-text-muted" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate text-list-meta text-text-muted">
            {artifact.name}
          </span>
        </button>
      ))}
    </div>
  );
}
