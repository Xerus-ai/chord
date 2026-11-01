import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { workItems } from './schema-work-items';

export const artifacts = sqliteTable(
  'artifacts',
  {
    id: text('id').primaryKey(),
    workItemId: text('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    filePath: text('file_path').notNull().default(''),
    name: text('name').notNull(),
    contentType: text('content_type').notNull().default('markdown'),
    type: text('type').notNull().default('markdown'),
    content: text('content').notNull().default(''),
    status: text('status').notNull().default('draft'),
    cloudId: text('cloud_id'),
    syncedAt: integer('synced_at'),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    workItemIdIdx: index('idx_artifacts_work_item_id').on(table.workItemId),
    workItemFilePathIdx: uniqueIndex('idx_artifacts_work_item_file_path').on(
      table.workItemId,
      table.filePath
    ),
  })
);

export const artifactComments = sqliteTable(
  'artifact_comments',
  {
    id: text('id').primaryKey(),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    parentCommentId: text('parent_comment_id'),
    body: text('body').notNull(),
    authorName: text('author_name').notNull().default('User'),
    anchorKey: text('anchor_key'),
    anchorText: text('anchor_text'),
    resolved: integer('resolved').notNull().default(0),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    artifactIdx: index('idx_artifact_comments_artifact_id').on(table.artifactId),
  })
);

export const artifactVersions = sqliteTable(
  'artifact_versions',
  {
    id: text('id').primaryKey(),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    authorName: text('author_name'),
    label: text('label'),
    content: text('content').notNull().default(''),
    byteSize: integer('byte_size').notNull().default(0),
    trigger: text('trigger').notNull().default('manual'),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    artifactIdx: index('idx_artifact_versions_artifact_id').on(
      table.artifactId,
      table.versionNumber
    ),
  })
);

export type ArtifactRow = typeof artifacts.$inferSelect;
export type ArtifactInsert = typeof artifacts.$inferInsert;
