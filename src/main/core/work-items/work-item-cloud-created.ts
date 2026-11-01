/**
 * The moment a local work item's cloud create is confirmed (sync-queue-send.ts)
 * — from then on the cloud row exists, so its room can be joined. The device
 * socket listens (wired in index.ts) and joins at once: waiting for its
 * minute-long room sweep left every message sent in that minute out of this
 * device's chat_messages, and the rail counted "0 msgs" for a chat holding
 * them (devstation-ni0). A plain listener set, as gitStateCaptureService's
 * onTargetsAdded, so the sync queue never imports the socket.
 */
const listeners = new Set<(workItemId: string) => void>();

export function onWorkItemCloudCreated(listener: (workItemId: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function announceWorkItemCloudCreated(workItemId: string): void {
  for (const listener of listeners) listener(workItemId);
}
