import { index, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { artifacts } from './schema-artifacts';

/**
 * The files an artifact was written from (`publish_artifact` `sources`), with
 * each file's content hash as of the last publish or review. An artifact is
 * out of date when a source's hash on disk no longer matches — the doc
 * describes code that has since changed.
 */
export const artifactSources = sqliteTable(
  'artifact_sources',
  {
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    contentHash: text('content_hash').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.artifactId, table.path] }),
    artifactIdx: index('idx_artifact_sources_artifact_id').on(table.artifactId),
  })
);

export type ArtifactSourceRow = typeof artifactSources.$inferSelect;
