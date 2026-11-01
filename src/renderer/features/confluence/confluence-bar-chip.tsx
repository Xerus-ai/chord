import type { ArtifactType } from '@shared/stream-items';
import { cn } from '@renderer/utils/utils';
import { confluenceChip } from './confluence-chip';
import { useConfluenceConnection, useConfluencePublication } from './use-confluence';

/**
 * The file bar's Confluence chip (shared-items design §5): a published
 * artifact's page status as a dot; a click opens the Share dialog on
 * Publish. The owner's alone, and only once the artifact was published.
 */
export function ConfluenceBarChip({
  artifactId,
  artifactType,
  content,
  onPublished,
  onOpenPublish,
}: {
  artifactId: string;
  artifactType: ArtifactType | null;
  content: string | null;
  onPublished: () => void;
  onOpenPublish: () => void;
}) {
  const connection = useConfluenceConnection();
  const { status } = useConfluencePublication({
    artifactId,
    artifactType,
    content: content ?? '',
    onPublished,
    enabled: connection.status?.connected === true && content !== null,
  });
  const chip = confluenceChip(status ?? null);
  if (!chip) return null;
  return (
    <button
      type="button"
      title={chip.title}
      aria-label={chip.title}
      data-testid="confluence-chip"
      onClick={onOpenPublish}
      className="inline-flex h-[26px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-[7px] text-tiny tracking-tiny text-text-muted transition-colors hover:bg-surface-hover-solid hover:text-text"
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          chip.tone === 'ok' ? 'bg-status-ok' : 'bg-status-warn'
        )}
      />
      Confluence
    </button>
  );
}
