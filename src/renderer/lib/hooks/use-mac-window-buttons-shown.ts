import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { windowFullScreenChangedChannel } from '@shared/events/appEvents';
import { events, rpc } from '@renderer/lib/ipc';

const FULL_SCREEN_KEY = ['app', 'windowFullScreen'] as const;

/**
 * Whether the macOS window buttons (`hiddenInset`, main/app/window.ts) sit over
 * the top-left of the window: on macOS, except in full screen, which hides them.
 */
export function useMacWindowButtonsShown(): boolean {
  const queryClient = useQueryClient();
  const { data: platform } = useQuery({
    queryKey: ['app', 'platform'],
    queryFn: () => rpc.app.getPlatform(),
    staleTime: Infinity,
  });
  const { data: fullScreen } = useQuery({
    queryKey: FULL_SCREEN_KEY,
    queryFn: () => rpc.app.isWindowFullScreen(),
    staleTime: Infinity,
  });

  useEffect(
    () =>
      events.on(windowFullScreenChangedChannel, (change: { fullScreen: boolean }) =>
        queryClient.setQueryData(FULL_SCREEN_KEY, change.fullScreen)
      ),
    [queryClient]
  );

  return platform === 'darwin' && fullScreen === false;
}
