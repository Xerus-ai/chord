import { useCallback, useState } from 'react';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { reportViewWarnings } from './report-view-warnings';
import type { ArtifactVersion } from './use-versions';

/** A document restore waiting for the live editor: its content, and the label to save it under. */
export interface DocumentReplacement {
  key: string;
  html: string;
  label: string;
}

interface UseArtifactRestoreOptions {
  artifactId: string;
  /** Only the author's own copy restores (the local source). */
  canRestore: boolean;
  isDocument: boolean;
  versions: ArtifactVersion[];
  previewVersion: ArtifactVersion | null;
  /** A document version's HTML while it is previewed. */
  previewHtml: string | null;
  clearPreview: () => void;
  refetchVersions: () => Promise<void>;
  saveVersion: (content: string, label: string) => Promise<void>;
  /**
   * Closing a document's preview mounts a fresh editor. Its readiness is
   * reported anew, and the replacement waits for that report.
   */
  resetDocumentReady: () => void;
  onDocumentTouched?: () => void;
}

function describe(error: { type: string; message?: string }): string {
  return error.message ?? error.type;
}

/**
 * Restore (shared-items step 1, S7): the version being viewed becomes the
 * newest. A page or file is restored in main, which puts the file back and
 * saves it (`artifacts.restoreVersion`). A document is restored through its
 * live editor, so every peer in the room sees it: the preview closes, and
 * once the editor holds the synced document it takes the old content and
 * that is saved as "Restored vN".
 */
export function useArtifactRestore({
  artifactId,
  canRestore,
  isDocument,
  versions,
  previewVersion,
  previewHtml,
  clearPreview,
  refetchVersions,
  saveVersion,
  resetDocumentReady,
  onDocumentTouched,
}: UseArtifactRestoreOptions) {
  const [replacement, setReplacement] = useState<DocumentReplacement | null>(null);

  const restore = useCallback(async () => {
    if (!previewVersion) return;
    const label = `Restored v${previewVersion.version_number}`;
    onDocumentTouched?.();
    if (isDocument) {
      if (previewHtml === null) throw new Error('A document version is restored from its preview');
      setReplacement({ key: `${previewVersion.id}:${Date.now()}`, html: previewHtml, label });
      resetDocumentReady();
      clearPreview();
      return;
    }
    const result = await rpc.artifacts.restoreVersion({
      artifactId,
      versionId: previewVersion.id,
      baseVersion: versions[0]?.version_number ?? 0,
    });
    if (!result.success) {
      const conflict = result.error.type === 'conflict';
      toast({
        title: 'Version not restored',
        description: describe(result.error),
        variant: conflict ? undefined : 'destructive',
      });
      if (conflict) await refetchVersions();
      return;
    }
    reportViewWarnings(`version ${result.data.version.versionNumber}`, result.data.warnings);
    clearPreview();
    await refetchVersions();
  }, [
    artifactId,
    isDocument,
    previewVersion,
    previewHtml,
    versions,
    clearPreview,
    refetchVersions,
    resetDocumentReady,
    onDocumentTouched,
  ]);

  /** The editor applied the replacement: save what it now holds. */
  const handleReplaced = useCallback(
    (html: string) => {
      const label = replacement?.label;
      setReplacement(null);
      if (label) void saveVersion(html, label);
    },
    [replacement, saveVersion]
  );

  return {
    onRestore: canRestore && previewVersion ? () => void restore() : undefined,
    replacement,
    onReplaced: handleReplaced,
  };
}
