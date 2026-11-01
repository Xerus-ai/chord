import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { artifacts } from './schema-artifacts';

/**
 * Where an artifact is published in Confluence (plan 2026-09-23 §4 P5). One
 * page per artifact: republishing updates the same `page_id`. Chord stays the
 * source of truth — the recorded versions are what status compares against:
 * `published_artifact_version` against the artifact's current content ("Out
 * of date"), `confluence_version` against the page's remote version ("Edited
 * in Confluence").
 */
export const confluencePublications = sqliteTable('confluence_publications', {
  artifactId: text('artifact_id')
    .primaryKey()
    .references(() => artifacts.id, { onDelete: 'cascade' }),
  spaceKey: text('space_key').notNull(),
  pageId: text('page_id').notNull(),
  confluenceVersion: integer('confluence_version').notNull(),
  publishedArtifactVersion: integer('published_artifact_version').notNull(),
  publishedAt: integer('published_at').notNull(),
});

export type ConfluencePublicationRow = typeof confluencePublications.$inferSelect;
