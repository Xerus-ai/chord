import { agentSessionsChangedChannel } from '@shared/events/agentEvents';
import { events } from '@main/lib/events';

/** Tells the renderer `workItemId`'s sessions changed (`agentSessionsChangedChannel`). */
export function announceSessionsChanged(workItemId: string): void {
  events.emit(agentSessionsChangedChannel, { workItemId }, workItemId);
}
