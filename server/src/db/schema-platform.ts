import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { organizations, users } from './schema.js';

/**
 * Billing webhooks, workflows, integrations and team pulse summaries.
 *
 * One of the server schema modules (schema*.ts): db/client.ts merges them,
 * and drizzle-kit reads them all.
 */

// ─── Polar Webhook Events (billing idempotency) ─────────────────────────────

// Every received Polar webhook is recorded here inside the SAME transaction
// as the state change it caused; the insert uses ON CONFLICT DO NOTHING on the
// primary key, so a redelivered event is a genuine no-op instead of a double
// plan change. event_id comes from the `webhook-id` header (falling back to
// the payload id).
export const polarWebhookEvents = pgTable('polar_webhook_events', {
  event_id: text('event_id').primaryKey(),
  event_type: text('event_type').notNull(),
  org_id: text('org_id'),
  payload: jsonb('payload').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Workflows ───────────────────────────────────────────────────────────────

export const workflows = pgTable('workflows', {
  id: text('id').primaryKey(),
  org_id: text('org_id')
    .notNull()
    .references(() => organizations.id),
  name: text('name').notNull(),
  template: text('template'),
  is_default: boolean('is_default').default(false),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Workflow Stages ─────────────────────────────────────────────────────────

export const workflowStages = pgTable('workflow_stages', {
  id: text('id').primaryKey(),
  workflow_id: text('workflow_id')
    .notNull()
    .references(() => workflows.id),
  name: text('name').notNull(),
  stage_order: integer('stage_order').notNull(),
  agent_provider: text('agent_provider'),
  agent_model: text('agent_model'),
  output_type: text('output_type'),
  description: text('description'),
  config: jsonb('config').default({}),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Workflow Gates ──────────────────────────────────────────────────────────

export const workflowGates = pgTable('workflow_gates', {
  id: text('id').primaryKey(),
  stage_id: text('stage_id')
    .notNull()
    .references(() => workflowStages.id),
  description: text('description').notNull(),
  gate_type: text('gate_type').notNull(),
  config: jsonb('config').default({}),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Integrations ────────────────────────────────────────────────────────────

export const integrations = pgTable(
  'integrations',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id')
      .notNull()
      .references(() => organizations.id),
    provider: text('provider').notNull(),
    status: text('status').notNull().default('disconnected'),
    account_name: text('account_name'),
    config: jsonb('config').default({}),
    last_synced_at: timestamp('last_synced_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('uq_integrations_org_provider').on(table.org_id, table.provider)]
);

// ─── Team Pulse Summaries ────────────────────────────────────────────────────

export const teamPulseSummaries = pgTable(
  'team_pulse_summaries',
  {
    id: text('id').primaryKey(),
    org_id: text('org_id')
      .notNull()
      .references(() => organizations.id),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id),
    summary: text('summary').notNull(),
    pr_refs: jsonb('pr_refs').default([]),
    period_start: timestamp('period_start', { withTimezone: true }).notNull(),
    period_end: timestamp('period_end', { withTimezone: true }).notNull(),
    generated_at: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_pulse_org_period').on(table.org_id, table.period_end)]
);
