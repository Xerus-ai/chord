import { isLiveDocumentType } from '@shared/confluence';
import { confluencePublicationChannel } from '@shared/events/confluenceEvents';
import type { ArtifactType } from '@shared/stream-items';
import { getArtifact } from '@main/core/artifacts/getArtifact';
import { appSettingsService } from '@main/core/settings/settings-service';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { findPublication } from './publication-records';
import { EditedInConfluenceError, publishArtifactToConfluence } from './publish-to-confluence';

/**
 * "Update the Confluence page automatically" (Publishing card, P5). An
 * artifact changes deliberately when a version is saved, an in-place edit is
 * committed, or the agent republishes it; each of those calls this. A page
 * edited in Confluence is never overwritten automatically — it reports its
 * status instead, and the person decides.
 *
 * `savedContent` is the content just saved as a version. A document is only
 * updated from that (its live content is in the editor, not the file); other
 * formats publish their file and ignore it.
 */
export function updateConfluenceAfterChange(args: {
  artifactId: string;
  savedContent?: string;
}): void {
  void runAutoUpdate(args).catch((error: unknown) => {
    if (error instanceof EditedInConfluenceError) {
      events.emit(confluencePublicationChannel, {
        artifactId: args.artifactId,
        status: error.status,
      });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    log.warn('confluence: automatic update failed', {
      artifactId: args.artifactId,
      error: message,
    });
    events.emit(confluencePublicationChannel, { artifactId: args.artifactId, error: message });
  });
}

async function runAutoUpdate(args: { artifactId: string; savedContent?: string }): Promise<void> {
  const { confluenceUpdateMode } = await appSettingsService.get('artifacts');
  if (confluenceUpdateMode !== 'auto' || !findPublication(args.artifactId)) return;
  const artifact = await getArtifact(args.artifactId);
  if (!artifact) return;
  const liveDocument = isLiveDocumentType(artifact.type as ArtifactType);
  if (liveDocument && args.savedContent === undefined) return;

  const status = await publishArtifactToConfluence({
    artifactId: args.artifactId,
    documentHtml: liveDocument ? args.savedContent : undefined,
  });
  log.info('confluence: page updated automatically', { artifactId: args.artifactId });
  events.emit(confluencePublicationChannel, { artifactId: args.artifactId, status });
}
