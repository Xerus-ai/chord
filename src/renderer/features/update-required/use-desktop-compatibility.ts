import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { desktopCompatibilityChangedChannel } from '@shared/events/appEvents';
import type { DesktopCompatibility } from '@main/core/app/desktop-compatibility';
import { events, rpc } from '@renderer/lib/ipc';

const KEY = ['app', 'desktop-compatibility'] as const;

/**
 * The sync server's verdict on this app's version (devstation-mg6u.2): read once
 * from main, then replaced by each change main reports.
 */
export function useDesktopCompatibility() {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      events.on(desktopCompatibilityChangedChannel, (state: DesktopCompatibility) => {
        queryClient.setQueryData(KEY, state);
      }),
    [queryClient]
  );
  return useQuery({
    queryKey: KEY,
    queryFn: (): Promise<DesktopCompatibility> => rpc.app.getDesktopCompatibility(),
    staleTime: Infinity,
  });
}
