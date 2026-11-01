import { and, count, eq } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client.js';
import { notifications } from '../db/schema-sharing.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { listNotificationViewsForUser } from '../notifications/list-notification-views.js';

export const notificationsRouter = Router();

// The facts with the names they point at, newest first
// (list-notification-views.ts): the same view a live frame carries.
notificationsRouter.get('/', async (req, res) => {
  const { user } = req as AuthenticatedRequest;
  res.json(await listNotificationViewsForUser(user.userId, 50));
});

notificationsRouter.get('/unread-count', async (req, res) => {
  const { user } = req as AuthenticatedRequest;

  const [result] = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.user_id, user.userId), eq(notifications.read, false)));

  res.json({ count: result?.value ?? 0 });
});

notificationsRouter.patch('/:id/read', async (req, res) => {
  const { user } = req as unknown as AuthenticatedRequest;
  const { id } = req.params;

  const [notification] = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.id, id), eq(notifications.user_id, user.userId)))
    .limit(1);

  if (!notification) {
    res.status(404).json({ error: 'Notification not found' });
    return;
  }

  await db.update(notifications).set({ read: true }).where(eq(notifications.id, id));

  res.json({ ...notification, read: true });
});

notificationsRouter.patch('/read-all', async (req, res) => {
  const { user } = req as AuthenticatedRequest;

  await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.user_id, user.userId), eq(notifications.read, false)));

  res.json({ status: 'ok' });
});
