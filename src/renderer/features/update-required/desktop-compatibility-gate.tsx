import type { ReactNode } from 'react';
import { ThemeProvider } from '@renderer/lib/providers/theme-provider';
import { StartupPlaceholder } from '@renderer/lib/ui/startup-placeholder';
import { UpdateRequired } from './update-required';
import { useDesktopCompatibility } from './use-desktop-compatibility';

/**
 * In front of the whole app: the sync server's verdict on this version decides
 * what shows.
 *   no reading yet          a blank surface, so neither the workspace nor the
 *                           sign-in wordmark paints and is then swapped out
 *   update_required         the update screen, instead of everything else
 *   supported, or unknown   the app (a failed read never blocks)
 * Main reports its first completed reading even when it is unknown, so the
 * blank surface lasts at most one first reading (its 3 s timeout). A failed
 * RPC read lets the app through, as unknown does. What the gate shows itself
 * is themed here; the app themes its own screens.
 */
export function DesktopCompatibilityGate({ children }: { children: ReactNode }) {
  const { data: compatibility, isError } = useDesktopCompatibility();

  if (compatibility?.state === 'update_required') {
    return (
      <ThemeProvider>
        <UpdateRequired current={compatibility.current} minimum={compatibility.minimum} />
      </ThemeProvider>
    );
  }
  const waiting =
    !isError &&
    (compatibility === undefined || (compatibility.state === 'unknown' && !compatibility.checked));
  if (waiting) {
    return (
      <ThemeProvider>
        <StartupPlaceholder />
      </ThemeProvider>
    );
  }
  return <>{children}</>;
}
