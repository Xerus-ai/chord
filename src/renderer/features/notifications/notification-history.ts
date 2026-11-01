import type { NotificationView } from '@chord/protocol';

/**
 * The bell's one list: the persisted history (GET /notifications) with the
 * live frames that arrived since, deduped by id, newest first. Both are the
 * same NotificationView. Read is monotonic — union, never override — so an
 * item read on either side stays read; `invite_id` only ever rides a live
 * frame, so the frame's wins.
 */
export function mergeNotifications(
  history: NotificationView[],
  live: NotificationView[]
): NotificationView[] {
  const byId = new Map<string, NotificationView>();
  for (const row of history) byId.set(row.id, row);
  for (const frame of live) {
    const prev = byId.get(frame.id);
    const merged: NotificationView = {
      ...prev,
      ...frame,
      read: (prev?.read ?? false) || frame.read,
    };
    const inviteId = frame.invite_id ?? prev?.invite_id;
    byId.set(frame.id, inviteId ? { ...merged, invite_id: inviteId } : merged);
  }
  return [...byId.values()].sort((a, b) =>
    a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0
  );
}
