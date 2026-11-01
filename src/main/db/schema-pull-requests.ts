import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const pullRequestUsers = sqliteTable('pull_request_users', {
  userId: text('user_id').primaryKey(),
  userName: text('user_name').notNull(),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  url: text('url'),
  userUpdatedAt: text('user_updated_at'),
  userCreatedAt: text('user_created_at'),
});

export const pullRequests = sqliteTable(
  'pull_requests',
  {
    url: text('url').primaryKey(),
    provider: text('provider').notNull().default('github'),
    repositoryUrl: text('repository_url').notNull(),
    baseRefName: text('base_ref_name').notNull(),
    baseRefOid: text('base_ref_oid').notNull(),
    headRepositoryUrl: text('head_repository_url').notNull(),
    headRefName: text('head_ref_name').notNull(),
    headRefOid: text('head_ref_oid').notNull(),
    identifier: text('identifier'),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status').notNull().default('open'),
    isDraft: integer('is_draft'),
    authorUserId: text('author_user_id').references(() => pullRequestUsers.userId, {
      onDelete: 'set null',
    }),
    additions: integer('additions'),
    deletions: integer('deletions'),
    changedFiles: integer('changed_files'),
    commitCount: integer('commit_count'),
    mergeableStatus: text('mergeable_status'),
    mergeStateStatus: text('merge_state_status'),
    reviewDecision: text('review_decision'),
    pullRequestCreatedAt: text('pull_request_created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    pullRequestUpdatedAt: text('pull_request_updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    urlIdx: uniqueIndex('idx_pull_requests_url').on(table.url),
    repositoryUrlIdx: index('idx_pull_requests_repository_url').on(table.repositoryUrl),
    headRepositoryUrlIdx: index('idx_pull_requests_head_repository_url').on(
      table.headRepositoryUrl
    ),
  })
);

export const pullRequestLabels = sqliteTable(
  'pull_request_labels',
  {
    pullRequestId: text('pull_request_id')
      .notNull()
      .references(() => pullRequests.url, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.pullRequestId, table.name] }),
    nameIdx: index('idx_prl_name').on(table.name),
  })
);

export const pullRequestAssignees = sqliteTable(
  'pull_request_assignees',
  {
    pullRequestUrl: text('pull_request_url')
      .notNull()
      .references(() => pullRequests.url, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => pullRequestUsers.userId, { onDelete: 'cascade' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.pullRequestUrl, table.userId] }),
    pullRequestUrlIdx: index('idx_pra_pull_request_url').on(table.pullRequestUrl),
    userIdIdx: index('idx_pra_user_id').on(table.userId),
  })
);

export const pullRequestChecks = sqliteTable(
  'pull_request_checks',
  {
    id: text('id').primaryKey(),
    pullRequestUrl: text('pull_request_url')
      .notNull()
      .references(() => pullRequests.url, { onDelete: 'cascade' }),
    commitSha: text('commit_sha').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull(),
    conclusion: text('conclusion').notNull(),
    detailsUrl: text('details_url'),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    workflowName: text('workflow_name'),
    appName: text('app_name'),
    appLogoUrl: text('app_logo_url'),
  },
  (table) => ({
    pullRequestUrlIdx: index('idx_prc_pull_request_url').on(table.pullRequestUrl),
  })
);

export const pullRequestReviews = sqliteTable(
  'pull_request_reviews',
  {
    id: text('id').primaryKey(),
    pullRequestUrl: text('pull_request_url')
      .notNull()
      .references(() => pullRequests.url, { onDelete: 'cascade' }),
    reviewerId: text('reviewer_id').notNull(),
    reviewerLogin: text('reviewer_login').notNull(),
    reviewerAvatarUrl: text('reviewer_avatar_url'),
    state: text('state').notNull(),
    submittedAt: text('submitted_at'),
    body: text('body'),
  },
  (table) => ({
    pullRequestUrlIdx: index('idx_prr_pull_request_url').on(table.pullRequestUrl),
  })
);

export const pullRequestReviewComments = sqliteTable(
  'pull_request_review_comments',
  {
    id: text('id').primaryKey(),
    pullRequestUrl: text('pull_request_url')
      .notNull()
      .references(() => pullRequests.url, { onDelete: 'cascade' }),
    reviewId: text('review_id').notNull(),
    path: text('path'),
    line: integer('line'),
    body: text('body').notNull(),
    authorLogin: text('author_login').notNull(),
    authorAvatarUrl: text('author_avatar_url'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    pullRequestUrlIdx: index('idx_prrc_pull_request_url').on(table.pullRequestUrl),
    reviewIdIdx: index('idx_prrc_review_id').on(table.reviewId),
  })
);

export type PullRequestReviewRow = typeof pullRequestReviews.$inferSelect;
export type PullRequestReviewCommentRow = typeof pullRequestReviewComments.$inferSelect;
