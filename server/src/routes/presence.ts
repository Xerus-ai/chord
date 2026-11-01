import { and, eq, inArray, sql } from 'drizzle-orm';
import { Router } from 'express';
import { requireWorkItemRole } from '../access/access-middleware.js';
import { db } from '../db/client.js';
import { presence } from '../db/schema-sharing.js';
import { orgMemberships, users, workItems } from '../db/schema.js';
import { DEV_MODE, type AuthenticatedRequest } from '../middleware/auth.js';

export const presenceRouter = Router();

function callerOrgIds(userId: string) {
  return db
    .select({ org_id: orgMemberships.org_id })
    .from(orgMemberships)
    .where(eq(orgMemberships.user_id, userId));
}

function orgTeammateIds(userId: string) {
  return db
    .select({ user_id: orgMemberships.user_id })
    .from(orgMemberships)
    .where(inArray(orgMemberships.org_id, callerOrgIds(userId)));
}

presenceRouter.get('/online-users', async (req, res) => {
  const { user } = req as AuthenticatedRequest;
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const recent = sql`${presence.last_seen} > ${fiveMinutesAgo}`;

  const result = await db
    .select({
      user_id: presence.user_id,
      status: presence.status,
      work_item_id: presence.work_item_id,
      last_seen: presence.last_seen,
      email: users.email,
      name: users.name,
      avatar_url: users.avatar_url,
      work_item_name: workItems.name,
    })
    .from(presence)
    .innerJoin(users, eq(presence.user_id, users.id))
    .leftJoin(
      workItems,
      DEV_MODE
        ? eq(presence.work_item_id, workItems.id)
        : and(
            eq(presence.work_item_id, workItems.id),
            inArray(workItems.org_id, callerOrgIds(user.userId))
          )
    )
    .where(DEV_MODE ? recent : and(recent, inArray(presence.user_id, orgTeammateIds(user.userId))))
    // A user can now hold several presence rows (one per work item plus the
    // NULL connect row); surface work-item-scoped rows first, freshest first,
    // so consumers that keep the first row per user get the informative one.
    .orderBy(sql`${presence.work_item_id} is null`, sql`${presence.last_seen} desc`);

  res.json(result);
});

presenceRouter.get('/summary/by-work-item', async (req, res) => {
  const { user } = req as AuthenticatedRequest;
  const hasWorkItem = sql`${presence.work_item_id} is not null`;

  const result = await db
    .select({
      work_item_id: presence.work_item_id,
      work_item_name: workItems.name,
      online_count: sql<number>`count(*) filter (where ${presence.status} = 'online')`,
      total_count: sql<number>`count(*)`,
    })
    .from(presence)
    .innerJoin(workItems, eq(presence.work_item_id, workItems.id))
    .where(
      DEV_MODE
        ? hasWorkItem
        : and(hasWorkItem, inArray(workItems.org_id, callerOrgIds(user.userId)))
    )
    .groupBy(presence.work_item_id, workItems.name);

  res.json(result);
});

presenceRouter.get('/:work_item_id', requireWorkItemRole('view'), async (req, res) => {
  const work_item_id = req.params.work_item_id as string;

  const result = await db
    .select({
      user_id: presence.user_id,
      status: presence.status,
      cursor_position: presence.cursor_position,
      active_view: presence.active_view,
      last_seen: presence.last_seen,
      email: users.email,
      name: users.name,
      avatar_url: users.avatar_url,
    })
    .from(presence)
    .innerJoin(users, eq(presence.user_id, users.id))
    .where(eq(presence.work_item_id, work_item_id));

  res.json(result);
});
