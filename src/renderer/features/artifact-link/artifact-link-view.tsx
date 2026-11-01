import { useEffect, type ReactNode } from 'react';
import { useCloudArtifactDetail } from '@renderer/features/artifacts/cloud/use-cloud-artifact';
import { CloudApiError } from '@renderer/lib/cloud-fetch';
import { StateCard } from '@renderer/lib/components/state-card';
import { useNavigate, useParams } from '@renderer/lib/layout/navigation-provider';

const RETRY_BUTTON_CLASS =
  'cursor-pointer rounded-lg bg-action-bg px-4 py-1.5 text-tiny tracking-tiny font-bold text-action-fg transition-colors duration-100 hover:bg-action-bg-hover';

/** Exists so the registry can infer the view's params. */
function ArtifactLinkWrapper({ children }: { children: ReactNode; artifactId?: string }) {
  return <>{children}</>;
}

/**
 * An artifact opened by id — a `chord://open/artifact/…` link, a notification
 * (step 4, decision 9). It only finds the artifact's work item and opens the
 * artifact there as a tab: the whole work item for someone who reaches it,
 * the work item scoped to its shared artifacts for someone the artifact alone
 * was shared with. The work list's resolution tells the two apart.
 */
function ArtifactLinkMainPanel() {
  const { params } = useParams('artifact-link');
  const artifactId = params.artifactId ?? null;
  const { navigate } = useNavigate();
  const detailQuery = useCloudArtifactDetail(artifactId ?? '', artifactId !== null);
  const detail = detailQuery.data;

  useEffect(() => {
    if (!detail) return;
    navigate('work-list', {
      workItemId: detail.work_item_id,
      openArtifact: { workItemId: detail.work_item_id, artifactId: detail.id, title: detail.name },
    });
  }, [detail, navigate]);

  if (detailQuery.error) {
    const missing = detailQuery.error instanceof CloudApiError && detailQuery.error.status === 404;
    return missing ? (
      <StateCard
        badge="No access"
        tone="error"
        title="This artifact isn't available to you"
        description="It may have been deleted, or its author stopped sharing it with you."
      />
    ) : (
      <StateCard
        badge="Error"
        tone="error"
        title="Couldn't load this artifact"
        description={detailQuery.error.message}
        action={
          <button onClick={() => void detailQuery.refetch()} className={RETRY_BUTTON_CLASS}>
            Retry
          </button>
        }
      />
    );
  }
  return <div className="flex h-full bg-surface" />;
}

export const artifactLinkView = {
  WrapView: ArtifactLinkWrapper,
  TitlebarSlot: () => null,
  MainPanel: ArtifactLinkMainPanel,
};
