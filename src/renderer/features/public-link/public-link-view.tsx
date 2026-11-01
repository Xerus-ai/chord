import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, type ReactNode } from 'react';
import { artifactCloudApi } from '@renderer/features/artifacts/cloud/artifact-cloud-api';
import {
  navigationForPublicLink,
  type PublicLinkLookup,
} from '@renderer/features/deep-links/public-link-navigation';
import { useOpenTarget } from '@renderer/features/deep-links/use-open-target';
import { CloudApiError } from '@renderer/lib/cloud-fetch';
import { StateCard } from '@renderer/lib/components/state-card';
import { useAccountSession } from '@renderer/lib/hooks/useAccount';
import { useParams } from '@renderer/lib/layout/navigation-provider';

const CLOUD_API_BASE: string = import.meta.env.VITE_CLOUD_API_URL;

const RETRY_BUTTON_CLASS =
  'cursor-pointer rounded-lg bg-action-bg px-4 py-1.5 text-tiny tracking-tiny font-bold text-action-fg transition-colors duration-100 hover:bg-action-bg-hover';

/** Exists so the registry can infer the view's params. */
function PublicLinkWrapper({ children }: { children: ReactNode; token?: string }) {
  return <>{children}</>;
}

/**
 * A public link (`chord://open/p/…`) opened in the app (step 4, decision 10).
 * Signed in and able to reach the artifact: it opens as a tab of its work
 * item, through the artifact link. Otherwise the link opens in the browser,
 * which shows it to anyone; the app has no second, read-only copy of it.
 */
function PublicLinkMainPanel() {
  const { params } = useParams('public-link');
  const token = params.token ?? null;
  const openTarget = useOpenTarget();
  const session = useAccountSession();
  const signedIn = session.data ? session.data.isSignedIn === true : null;

  const resolveQuery = useQuery({
    queryKey: ['publicLink', 'resolve', token],
    queryFn: () => artifactCloudApi.resolvePublicLink(token!),
    enabled: token !== null && signedIn === true,
    retry: false,
  });

  const lookup = useMemo<PublicLinkLookup | null>(() => {
    if (signedIn === false) return { kind: 'signed_out' };
    if (resolveQuery.data) return { kind: 'resolved', artifactId: resolveQuery.data.artifact_id };
    const error = resolveQuery.error;
    if (error instanceof CloudApiError && error.status === 404) return { kind: 'not_found' };
    return null;
  }, [signedIn, resolveQuery.data, resolveQuery.error]);

  const target = token && lookup ? navigationForPublicLink(lookup, CLOUD_API_BASE, token) : null;

  useEffect(() => {
    if (target) openTarget(target);
    // Once per lookup: re-opening the browser on every render would spam tabs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookup]);

  if (token === null) return <div className="flex h-full bg-surface" />;

  if (target?.view === 'external') {
    return (
      <StateCard
        badge="Opened in browser"
        title="This link opened in your browser"
        description={
          lookup?.kind === 'signed_out'
            ? 'Sign in to open artifacts shared with you in Chord.'
            : 'It is not shared with you in Chord, so your browser shows it.'
        }
        action={
          <button onClick={() => openTarget(target)} className={RETRY_BUTTON_CLASS}>
            Open again
          </button>
        }
      />
    );
  }

  const error = resolveQuery.error;
  if (error && lookup === null) {
    return (
      <StateCard
        badge="Error"
        tone="error"
        title="Couldn't open this link"
        description={error.message}
        action={
          <button onClick={() => void resolveQuery.refetch()} className={RETRY_BUTTON_CLASS}>
            Retry
          </button>
        }
      />
    );
  }
  return <div className="flex h-full bg-surface" />;
}

export const publicLinkView = {
  WrapView: PublicLinkWrapper,
  TitlebarSlot: () => null,
  MainPanel: PublicLinkMainPanel,
};
