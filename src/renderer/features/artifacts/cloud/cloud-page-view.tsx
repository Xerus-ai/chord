import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { PageMode } from '@shared/artifact-frame-constants';
import type { PagePin, PickedElement } from '@shared/artifact-frame-messages';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { rpc } from '@renderer/lib/ipc';
import { ArtifactLoadError } from '../artifact-load-error';
import { PageFrame } from '../page/page-frame';
import { PagePickCard, usePagePick } from '../page/page-pick';
import type { ArtifactVersion } from '../use-versions';
import { describeCloudPageResult, type CloudPageState } from './cloud-page-state';

interface CloudPageViewProps {
  workItemId: string;
  artifactId: string;
  title: string;
  /** A stored version to show instead of the latest one. */
  previewVersion: ArtifactVersion | null;
  /** Bumped by the host when a new version with a view arrives. */
  reloadSignal: number;
  /** `pick` while the comments card is open: a click comments on what it lands on. */
  mode: PageMode;
  /** Absent when the viewer cannot have the agent edit this page. */
  onAskAgent?: (element: PickedElement, instruction: string) => void;
  onComment: (element: PickedElement, body: string) => void;
  /** The comments card's pins, at the stamped elements the view carries. */
  pins: PagePin[];
  selectedPin: number | null;
  onPinSelected: (n: number) => void;
}

const NO_PINS: PagePin[] = [];

/**
 * A page read from the cloud: the self-contained view the author's app
 * uploaded with a version (design 2026-09-24 §9), served by main from a
 * snapshot source in the P1a sandbox. Nothing here edits the page, but it is
 * commented on as the owner's is (shared-items design 2026-09-26 §6): the
 * view carries the frame bridge and the stamped element ids, so a click picks
 * and pins land where the owner's do. Pins are drawn on the latest view only.
 * A page with no uploaded view is an empty state, not an error.
 */
export function CloudPageView({
  workItemId,
  artifactId,
  title,
  previewVersion,
  reloadSignal,
  mode,
  onAskAgent,
  onComment,
  pins,
  selectedPin,
  onPinSelected,
}: CloudPageViewProps) {
  const { effectiveTheme } = useTheme();
  const [pageError, setPageError] = useState<string | null>(null);
  const versionId = previewVersion?.id;
  const frameMode: PageMode = previewVersion ? 'view' : mode;
  const { picked, onElementPicked, modeEpoch, releasePick } = usePagePick(frameMode);

  const query = useQuery({
    queryKey: ['cloudArtifact', 'page', artifactId, versionId ?? 'latest', reloadSignal],
    queryFn: async (): Promise<CloudPageState> => {
      const result = await rpc.artifactPages.prepareCloud({
        workItemId,
        artifactId,
        versionId,
        theme: effectiveTheme,
      });
      const state = describeCloudPageResult(result);
      if (state.kind !== 'ready') return state;
      // A reload must produce a new URL or React keeps the old frame.
      const url = new URL(state.url);
      url.searchParams.set('v', String(reloadSignal));
      return { ...state, url: url.toString() };
    },
    staleTime: Infinity,
  });

  const { refetch } = query;
  const handleReload = useCallback(() => {
    setPageError(null);
    void refetch();
  }, [refetch]);

  if (query.error) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ArtifactLoadError
          message={`The page could not be loaded: ${query.error.message}`}
          onRetry={handleReload}
        />
      </div>
    );
  }

  const state = query.data;
  if (!state) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <CenteredNote text="Preparing page…" />
      </div>
    );
  }

  if (state.kind === 'no-view') {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <CenteredNote text={state.message} />
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ArtifactLoadError message={state.message} onRetry={handleReload} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-shrink-0 border-b border-border-subtle px-4 py-2 text-tiny tracking-tiny text-text-passive">
        {state.label}
      </div>
      {pageError && (
        <ArtifactLoadError message={`Page error: ${pageError}`} onRetry={handleReload} />
      )}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <PageFrame
          key={state.url}
          url={state.url}
          theme={effectiveTheme}
          title={title}
          sizing="fill"
          onPageError={setPageError}
          onNavigationBlocked={handleReload}
          mode={frameMode}
          modeEpoch={modeEpoch}
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

function CenteredNote({ text }: { text: string }) {
  return (
    <div className="flex flex-1 items-center justify-center px-8 text-center text-body tracking-body text-text-passive">
      {text}
    </div>
  );
}
