import { useCallback, useMemo, useRef, useState } from 'react';
import type { PageMode } from '@shared/artifact-frame-constants';
import type { PagePin, PickedElement } from '@shared/artifact-frame-messages';
import type { ArtifactContentUpdate } from '@shared/events/artifactEvents';
import { toast } from '@renderer/lib/hooks/use-toast';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { rpc } from '@renderer/lib/ipc';
import { ArtifactLoadError } from '../artifact-load-error';
import type { ArtifactVersion } from '../use-versions';
import { editableTextIdsOf } from './editable-text-ids';
import { PageFrame } from './page-frame';
import { PagePickCard, usePagePick } from './page-pick';
import { usePreparedPage, type PageTarget } from './use-prepared-page';

interface ArtifactPageViewProps {
  artifactId: string;
  title: string;
  /**
   * A stored version to show instead of the live page. Its source is served
   * at its own sandboxed origin; nothing about it goes through the editor,
   * and it is never editable.
   */
  previewVersion?: ArtifactVersion | null;
  /** What the user has the page doing (plan 2026-09-23 P1b). */
  mode: PageMode;
  /** The page's source as it is now: which stamped elements are text decides what edits. */
  source: string;
  /** An in-place edit was written to the source and saved as a version. */
  onTextEdited: (content: string) => void;
  /** Absent when the viewer cannot have the agent edit this page. */
  onAskAgent?: (element: PickedElement, instruction: string) => void;
  onComment: (element: PickedElement, body: string) => void;
  /** The comments card's pins on the live page (shared-items step 1, S6). */
  pins: PagePin[];
  selectedPin: number | null;
  onPinSelected: (n: number) => void;
}

const NO_PINS: PagePin[] = [];

function targetFor(artifactId: string, version: ArtifactVersion | null | undefined): PageTarget {
  if (version) {
    return {
      kind: 'artifact-version',
      artifactId,
      versionId: version.id,
      content: version.content ?? '',
    };
  }
  return { kind: 'artifact', artifactId };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The centre-tab body for a `page` render class artifact (a web page or an
 * interactive prototype). A page that fails to prepare — the file is gone, or
 * the prototype does not compile — shows the reason with a retry, never a
 * blank frame; a runtime error inside the page is surfaced the same way while
 * the frame stays up.
 *
 * Editing levels: in `edit-text` an edited element is written to the source by
 * main, which reports the file change like any other. That change is this
 * view's own, and the frame already shows it, so it does not reload the frame
 * (a reload would drop the user's scroll position mid-edit). In `pick`, a
 * picked element opens the comment card over the frame. Pins are drawn on
 * the live page only: an old version's elements are not what the threads
 * are about now.
 */
export function ArtifactPageView({
  artifactId,
  title,
  previewVersion,
  mode,
  source,
  onTextEdited,
  onAskAgent,
  onComment,
  pins,
  selectedPin,
  onPinSelected,
}: ArtifactPageViewProps) {
  const { effectiveTheme } = useTheme();
  const ownWrites = useRef(new Set<string>());
  const isOwnWrite = useCallback(
    (update: ArtifactContentUpdate) => ownWrites.current.delete(update.content),
    []
  );
  const { url, loading, error, reload } = usePreparedPage(
    targetFor(artifactId, previewVersion),
    effectiveTheme,
    { isOwnWrite }
  );
  const [pageError, setPageError] = useState<string | null>(null);
  const frameMode: PageMode = previewVersion ? 'view' : mode;
  const { picked, onElementPicked, modeEpoch, releasePick } = usePagePick(frameMode);
  const editableIds = useMemo(
    () => (frameMode === 'edit-text' ? editableTextIdsOf(source) : []),
    [frameMode, source]
  );

  const handlePageError = useCallback((message: string) => {
    setPageError(message);
  }, []);

  const handleReload = useCallback(() => {
    setPageError(null);
    reload();
  }, [reload]);

  const handleTextEdit = useCallback(
    async (edit: { chordId: string; originalText: string; text: string }) => {
      try {
        const result = await rpc.artifactPages.commitTextEdit({ artifactId, ...edit });
        if (!result.success) throw new Error(result.error.message);
        if (!result.data.changed) return;
        ownWrites.current.add(result.data.content);
        onTextEdited(result.data.content);
      } catch (e) {
        // The frame shows text the source does not have; reloading puts the
        // source back on screen, so what the user sees is what is saved.
        toast({ title: 'Edit not saved', description: describe(e), variant: 'destructive' });
        reload();
      }
    },
    [artifactId, onTextEdited, reload]
  );

  if (error) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ArtifactLoadError message={error} onRetry={handleReload} />
        <div className="flex flex-1 items-center justify-center px-8 text-center text-body tracking-body text-text-passive">
          The page could not be built. Fix the source and retry.
        </div>
      </div>
    );
  }

  if (loading || !url) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-1 items-center justify-center text-body tracking-body text-text-passive">
          Preparing page…
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {pageError && (
        <ArtifactLoadError message={`Page error: ${pageError}`} onRetry={handleReload} />
      )}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <PageFrame
          key={url}
          url={url}
          theme={effectiveTheme}
          title={title}
          sizing="fill"
          onPageError={handlePageError}
          onNavigationBlocked={handleReload}
          mode={frameMode}
          modeEpoch={modeEpoch}
          editableIds={editableIds}
          onTextEdit={handleTextEdit}
          onElementPicked={onElementPicked}
          pins={previewVersion ? NO_PINS : pins}
          selectedPin={previewVersion ? null : selectedPin}
          onPinSelected={onPinSelected}
        />
        {picked && (
          <PagePickCard
            picked={picked}
            onAskAgent={onAskAgent}
            onComment={onComment}
            onRelease={releasePick}
          />
        )}
      </div>
    </div>
  );
}
