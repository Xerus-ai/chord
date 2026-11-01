import { relations } from 'drizzle-orm';
import { projects, sshConnections } from './schema-projects';

export * from './schema-infra';
export * from './schema-projects';
export * from './schema-pull-requests';

export const projectsRelations = relations(projects, ({ one }) => ({
  sshConnection: one(sshConnections, {
    fields: [projects.sshConnectionId],
    references: [sshConnections.id],
  }),
}));
