import { useQuery } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';

/**
 * Public-facing URLs (docs, terms, privacy) live in main-process env, which
 * `import.meta.env` cannot reach — the renderer reads them over RPC instead of
 * carrying its own hardcoded copies.
 */
export function usePublicUrls() {
  return useQuery({
    queryKey: ['app', 'publicUrls'],
    queryFn: () => rpc.app.getPublicUrls(),
    staleTime: Infinity,
  });
}
