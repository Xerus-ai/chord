import { relations } from 'drizzle-orm';
import { artifactComments, artifacts } from './schema-artifacts';
import { checkpoints } from './schema-checkpoints';
import {
  agentSessions,
  chatMessages,
  repos,
  workItems,
  workItemTickets,
  workItemWorktrees,
} from './schema-work-items';

/**
 * Drizzle relations for the work-item tables. They live apart from the tables
 * because they reference tables across `schema-work-items.ts`,
 * `schema-artifacts.ts` and `schema-checkpoints.ts`; declaring them beside the
 * tables would make those modules import each other.
 */

export const reposRelations = relations(repos, ({ many }) => ({
  workItems: many(workItems),
}));

export const workItemsRelations = relations(workItems, ({ one, many }) => ({
  repo: one(repos, {
    fields: [workItems.repoId],
    references: [repos.id],
  }),
  agentSessions: many(agentSessions),
  chatMessages: many(chatMessages),
  artifacts: many(artifacts),
  tickets: many(workItemTickets),
  worktrees: many(workItemWorktrees),
}));

export const workItemTicketsRelations = relations(workItemTickets, ({ one }) => ({
  workItem: one(workItems, {
    fields: [workItemTickets.workItemId],
    references: [workItems.id],
  }),
}));

export const agentSessionsRelations = relations(agentSessions, ({ one, many }) => ({
  workItem: one(workItems, {
    fields: [agentSessions.workItemId],
    references: [workItems.id],
  }),
  worktree: one(workItemWorktrees, {
    fields: [agentSessions.worktreeId],
    references: [workItemWorktrees.id],
  }),
  chatMessages: many(chatMessages),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  workItem: one(workItems, {
    fields: [chatMessages.workItemId],
    references: [workItems.id],
  }),
  session: one(agentSessions, {
    fields: [chatMessages.sessionId],
    references: [agentSessions.id],
  }),
}));

export const artifactsRelations = relations(artifacts, ({ one, many }) => ({
  workItem: one(workItems, {
    fields: [artifacts.workItemId],
    references: [workItems.id],
  }),
  comments: many(artifactComments),
}));

export const artifactCommentsRelations = relations(artifactComments, ({ one }) => ({
  artifact: one(artifacts, {
    fields: [artifactComments.artifactId],
    references: [artifacts.id],
  }),
}));

export const checkpointsRelations = relations(checkpoints, ({ one }) => ({
  workItem: one(workItems, {
    fields: [checkpoints.workItemId],
    references: [workItems.id],
  }),
  worktree: one(workItemWorktrees, {
    fields: [checkpoints.worktreeId],
    references: [workItemWorktrees.id],
  }),
}));

export const workItemWorktreesRelations = relations(workItemWorktrees, ({ one, many }) => ({
  workItem: one(workItems, {
    fields: [workItemWorktrees.workItemId],
    references: [workItems.id],
  }),
  agentSessions: many(agentSessions),
  checkpoints: many(checkpoints),
}));
