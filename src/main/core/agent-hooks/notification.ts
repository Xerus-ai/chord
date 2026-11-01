import { eq } from 'drizzle-orm';
import { BrowserWindow, Notification } from 'electron';
import { type AgentProviderId } from '@shared/agent-provider-registry';
import { getProvider } from '@shared/agent-providers';
import { isAttentionNotification, type AgentEvent } from '@shared/events/agentEvents';
import { notificationFocusWorkItemChannel } from '@shared/events/appEvents';
import { getMainWindow } from '@main/app/window';
import { appSettingsService } from '@main/core/settings/settings-service';
import { db } from '@main/db/client';
import { workItems } from '@main/db/schema-work-items';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';

function getNotificationBody(event: AgentEvent): string | null {
  if (event.type === 'stop') return 'Your agent has finished working';
  if (event.type === 'notification') {
    const { notificationType } = event.payload;
    if (!notificationType) return null;
    if (isAttentionNotification(notificationType)) {
      return 'Your agent is waiting for input';
    }
  }
  return null;
}

async function getWorkItemName(workItemId: string | undefined): Promise<string | null> {
  if (!workItemId) return null;
  const [row] = await db
    .select({ name: workItems.name })
    .from(workItems)
    .where(eq(workItems.id, workItemId))
    .limit(1);
  return row?.name ?? null;
}

export async function maybeShowNotification(event: AgentEvent, appFocused: boolean): Promise<void> {
  try {
    const { enabled, osNotifications } = await appSettingsService.get('notifications');
    if (!enabled || !osNotifications || appFocused || !Notification.isSupported()) return;

    const body = getNotificationBody(event);
    if (!body) return;

    const providerName = getProvider(event.providerId as AgentProviderId)?.name ?? event.providerId;
    const workItemName = await getWorkItemName(event.workItemId);
    const title = workItemName ? `${providerName} — ${workItemName}` : (providerName ?? 'Agent');

    const notification = new Notification({ title, body, silent: true });

    notification.on('click', () => {
      const win = getMainWindow();
      if (!win || win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      if (event.workItemId) {
        events.emit(notificationFocusWorkItemChannel, { workItemId: event.workItemId });
      }
    });

    notification.show();
  } catch (error) {
    log.warn('notification: failed to show OS notification', { error: String(error) });
  }
}

export function isAppFocused(): boolean {
  const windows = BrowserWindow.getAllWindows();
  return windows.some((w) => !w.isDestroyed() && w.isFocused());
}
