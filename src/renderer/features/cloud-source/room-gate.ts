import type { RoomJoinStatus } from '@renderer/lib/sync/room-registry';

/**
 * What a teammate's view shows from the work item's room. `revoked` replaces
 * the view with a card, which unmounts every live hook (presence sender,
 * viewers feed, the chat feed), and tells the work list to clear the requested
 * id so the params-sync never re-selects it.
 */
export type RoomGate = 'open' | 'denied' | 'revoked';

export function roomGateOf(status: RoomJoinStatus | null): RoomGate {
  if (status === 'denied') return 'denied';
  if (status === 'removed') return 'revoked';
  return 'open';
}
