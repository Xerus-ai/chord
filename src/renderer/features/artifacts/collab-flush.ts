import type { HocuspocusProvider } from '@hocuspocus/provider';

/**
 * Resolves once every local change to the provider's document has been
 * acknowledged by the collab server — the point from which a server-side
 * snapshot of the live state includes it. Rejects if that does not happen
 * within `timeoutMs` (disconnected, unauthenticated), so the caller reports it.
 */
export function waitForCollabFlush(provider: HocuspocusProvider, timeoutMs: number): Promise<void> {
  if (!provider.hasUnsyncedChanges) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const handler = ({ number }: { number: number }) => {
      if (number > 0) return;
      clearTimeout(timer);
      provider.off('unsyncedChanges', handler);
      resolve();
    };
    const timer = setTimeout(() => {
      provider.off('unsyncedChanges', handler);
      reject(
        new Error(`the collab server did not acknowledge the change within ${timeoutMs / 1000}s`)
      );
    }, timeoutMs);
    provider.on('unsyncedChanges', handler);
  });
}
