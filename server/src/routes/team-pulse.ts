import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import { teamPulseSummaries } from '../db/schema-platform.js';
import { presence } from '../db/schema-sharing.js';
import { orgMemberships, users, workItems } from '../db/schema.js';
import { requireOrgMembership } from '../middleware/access-control.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

export const teamPulseRouter = Router();

// Every route below is scoped to a single :org_id and must not leak data
// across tenants — requireOrgMembership confirms the caller belongs to that
// org before any query runs (mirrors organizations.ts).
teamPulseRouter.get('/:org_id', requireOrgMembership, async (req, res) => {
  const orgId = req.params.org_id as string;

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const summaries = await db
    .select({
      id: teamPulseSummaries.id,
      user_id: teamPulseSummaries.user_id,
      summary: teamPulseSummaries.summary,
      pr_refs: teamPulseSummaries.pr_refs,
      period_start: teamPulseSummaries.period_start,
      period_end: teamPulseSummaries.period_end,
      generated_at: teamPulseSummaries.generated_at,
      user_name: users.name,
      user_email: users.email,
      user_avatar: users.avatar_url,
    })
    .from(teamPulseSummaries)
    .innerJoin(users, eq(teamPulseSummaries.user_id, users.id))
    .where(
      and(eq(teamPulseSummaries.org_id, orgId), gte(teamPulseSummaries.period_end, sevenDaysAgo))
    )
    .orderBy(desc(teamPulseSummaries.generated_at))
    .limit(500);

  res.json(summaries);
});

teamPulseRouter.get('/:org_id/activity', requireOrgMembership, async (req, res) => {
  const orgId = req.params.org_id as string;

  // Presence has no org_id column, so scope it to the requesting org's
  // membership roster instead — same shape as presence.ts's orgTeammateIds,
  // narrowed to the single :org_id already verified by requireOrgMembership
  // rather than every org the caller belongs to.
  const orgMemberIds = db
    .select({ user_id: orgMemberships.user_id })
    .from(orgMemberships)
    .where(eq(orgMemberships.org_id, orgId));

  const onlineUsers = await db
    .select({
      user_id: presence.user_id,
      status: presence.status,
      work_item_id: presence.work_item_id,
      active_view: presence.active_view,
      last_seen: presence.last_seen,
      user_name: users.name,
      user_email: users.email,
      user_avatar: users.avatar_url,
    })
    .from(presence)
    .innerJoin(users, eq(presence.user_id, users.id))
    .where(inArray(presence.user_id, orgMemberIds))
    .orderBy(desc(presence.last_seen))
    .limit(500);

  res.json(onlineUsers);
});

teamPulseRouter.get('/:org_id/activity-context', requireOrgMembership, async (req, res) => {
  const orgId = req.params.org_id as string;
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const orgMemberIds = db
    .select({ user_id: orgMemberships.user_id })
    .from(orgMemberships)
    .where(eq(orgMemberships.org_id, orgId));

  const [members, recentItems] = await Promise.all([
    db
      .select({
        user_id: users.id,
        user_name: users.name,
        user_email: users.email,
      })
      .from(users)
      .where(inArray(users.id, orgMemberIds)),
    db
      .select({
        creator_id: workItems.creator_id,
        name: workItems.name,
        status: workItems.status,
        workflow_phase: workItems.workflow_phase,
        pr_number: workItems.pr_number,
        pr_url: workItems.pr_url,
        repo_name: workItems.repo_name,
        branch_name: workItems.branch_name,
        updated_at: workItems.updated_at,
      })
      .from(workItems)
      .where(and(eq(workItems.org_id, orgId), gte(workItems.updated_at, oneDayAgo)))
      .orderBy(desc(workItems.updated_at))
      .limit(200),
  ]);

  const presenceRows = await db
    .select({
      user_id: presence.user_id,
      status: presence.status,
      active_view: presence.active_view,
      last_seen: presence.last_seen,
    })
    .from(presence)
    .where(inArray(presence.user_id, orgMemberIds));

  const presenceMap = new Map(presenceRows.map((p) => [p.user_id, p]));

  const itemsByUser = new Map<string, typeof recentItems>();
  for (const item of recentItems) {
    const list = itemsByUser.get(item.creator_id) ?? [];
    list.push(item);
    itemsByUser.set(item.creator_id, list);
  }

  const result = members.map((member) => {
    const pres = presenceMap.get(member.user_id);
    const items = itemsByUser.get(member.user_id) ?? [];
    return {
      user_id: member.user_id,
      user_name: member.user_name,
      user_email: member.user_email,
      status: pres?.status ?? 'offline',
      active_view: pres?.active_view ?? null,
      last_seen: pres?.last_seen?.toISOString() ?? null,
      work_items: items.map((wi) => ({
        name: wi.name,
        status: wi.status,
        workflow_phase: wi.workflow_phase,
        pr_number: wi.pr_number,
        pr_url: wi.pr_url,
        repo_name: wi.repo_name,
        branch_name: wi.branch_name,
      })),
    };
  });

  res.json(result);
});

const SummaryPayloadSchema = z.object({
  summaries: z.array(
    z.object({
      summary: z.string(),
      pr_refs: z.array(z.object({ url: z.string(), title: z.string() })).default([]),
      period_start: z.string(),
      period_end: z.string(),
    })
  ),
});

teamPulseRouter.post('/:org_id/summaries', requireOrgMembership, async (req, res) => {
  const orgId = req.params.org_id as string;
  const { user } = req as unknown as AuthenticatedRequest;
  const parsed = SummaryPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }

  const rows = parsed.data.summaries.map((s) => ({
    id: randomUUID(),
    org_id: orgId,
    // Attributed to the authenticated caller, never a client-supplied user_id:
    // otherwise any org member could post a summary under another user's name.
    user_id: user.userId,
    summary: s.summary,
    pr_refs: s.pr_refs,
    period_start: new Date(s.period_start),
    period_end: new Date(s.period_end),
  }));

  if (rows.length > 0) {
    await db.insert(teamPulseSummaries).values(rows);
  }

  res.status(201).json({ stored: rows.length });
});
