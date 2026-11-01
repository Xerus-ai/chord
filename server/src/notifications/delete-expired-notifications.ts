import { and, eq, lt } from 'drizzle-orm';
import { db, hasDb } from '../db/client.js';
import { notifications } from '../db/schema-sharing.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A read notification is kept this long, then deleted (step 2 plan §1, decision 1). */
const RETENTION_MS = 30 * DAY_MS;

/**
 * Deletes read notifications created more than 30 days before `now`. Unread
 * ones stay however old they are: nobody has seen them yet.
 */
export async function deleteExpiredNotifications(now: Date): Promise<number> {
  const deleted = await db
    .delete(notifications)
    .where(
      and(
        eq(notifications.read, true),
        lt(notifications.created_at, new Date(now.getTime() - RETENTION_MS))
      )
    )
    .returning({ id: notifications.id });
  return deleted.length;
}

/** Runs the retention delete at startup and then daily. */
export function startNotificationRetention(): void {
  if (!hasDb) return;
  const run = () => {
    deleteExpiredNotifications(new Date()).catch((err: Error) => {
      console.error('[notifications] retention delete failed:', err.message);
    });
  };
  run();
  setInterval(run, DAY_MS).unref();
}
