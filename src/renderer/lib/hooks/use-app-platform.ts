import { useQuery } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';

/** The platform the app runs on, from the main process; undefined until it answers. */
export function useAppPlatform(): NodeJS.Platform | undefined {
  const { data } = useQuery({
    queryKey: ['app', 'platform'],
    queryFn: () => rpc.app.getPlatform() as Promise<NodeJS.Platform>,
    staleTime: Infinity,
  });
  return data;
}
