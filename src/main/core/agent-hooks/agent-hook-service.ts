import { agentEventChannel } from '@shared/events/agentEvents';
import { events } from '@main/lib/events';
import type { IDisposable, IInitializable } from '@main/lib/lifecycle';
import { enrichEvent } from './event-enricher';
import { HookServer } from './hook-server';
import { isAppFocused, maybeShowNotification } from './notification';
import { recordHookPromptEvent } from './pending-hook-prompts';

class AgentHookService implements IInitializable, IDisposable {
  private server = new HookServer();

  async initialize(): Promise<void> {
    await this.server.start(async (raw) => {
      const event = await enrichEvent(raw);
      event.source = 'hook';
      recordHookPromptEvent(event);
      const appFocused = isAppFocused();
      await maybeShowNotification(event, appFocused);
      // Renderer subscribers listen per work item (`agent:event.<workItemId>`);
      // an emit without the topic lands on a channel nobody listens to.
      if (!event.workItemId) throw new Error(`Hook event has no workItemId: ${event.ptyId}`);
      events.emit(agentEventChannel, { event, appFocused }, event.workItemId);
    });
  }

  dispose(): void {
    this.server.stop();
  }
  getPort(): number {
    return this.server.getPort();
  }
  getToken(): string {
    return this.server.getToken();
  }
}

export const agentHookService = new AgentHookService();
