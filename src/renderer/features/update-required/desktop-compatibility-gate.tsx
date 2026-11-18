import { Fragment, type ComponentType, type ReactNode } from 'react';
import { StartupPlaceholder } from '@renderer/lib/ui/startup-placeholder';
import { UpdateRequired } from './update-required';
import { useDesktopCompatibility } from './use-desktop-compatibility';

/**
 * In front of the whole app (devstation-mg6u.2, .5): the sync server's verdict
 * on this version decides what shows.
 *   no reading yet          a blank surface, so neither the workspace nor the
 *                           sign-in wordmark paints and is then swapped out
 *   update_required         the update screen, instead of everything else
 *   supported, or unknown   the app (a failed read never blocks)
 * Main reports its first completed reading even when it is unknown, so the
 * blank surface lasts at most one check (its 10 s timeout). A failed RPC read
 * lets the app through, as unknown does.
 * `frame` wraps what the gate itself shows (the app passes its ThemeProvider).
 */
export function DesktopCompatibilityGate({
  children,
  frame: Frame = Fragment,
}: {
  children: ReactNode;
  frame?: ComponentType<{ children: ReactNode }>;
}) {
  const { data: compatibility, isError } = useDesktopCompatibility();

  if (compatibility?.state === 'update_required') {
    return (
      <Frame>
        <UpdateRequired current={compatibility.current} minimum={compatibility.minimum} />
      </Frame>
    );
  }
  const waiting =
    !isError &&
    (compatibility === undefined || (compatibility.state === 'unknown' && !compatibility.checked));
  if (waiting) {
    return (
      <Frame>
        <StartupPlaceholder />
      </Frame>
    );
  }
  return <>{children}</>;
}
