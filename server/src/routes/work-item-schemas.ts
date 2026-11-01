import { z } from 'zod';

/** Request bodies of POST and PATCH /work-items (routes/work-items.ts). */

// The repo's normalized origin (`github.com/acme/chord`, never a URL with
// credentials): the desktop normalizes it before sending, and clients only
// ever compare it for equality.
const RepoRemoteUrlSchema = z.string().min(1).max(500);

export const CreateWorkItemSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().min(1),
  org_id: z.string(),
  status: z.string().default('active'),
  workflow_phase: z.string().default('build'),
  repo_name: z.string().optional(),
  repo_remote_url: RepoRemoteUrlSchema.optional(),
  branch_name: z.string().optional(),
  ticket_id: z.string().optional(),
  ticket_provider: z.string().optional(),
  ticket_url: z.string().optional(),
  agent_provider: z.string().optional(),
  // Who has access from the start (P6). The desktop sends the user's
  // You > Sharing default; a work item is never public.
  general_access: z.enum(['invited', 'team']).default('invited'),
  general_role: z.enum(['view', 'edit']).default('view'),
});

// general_access is deliberately excluded: it only changes through the
// author-gated PATCH /general-access (routes/sharing), never through this
// generic PATCH that any Can edit member may call.
export const UpdateWorkItemSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.string().optional(),
  workflow_phase: z.string().optional(),
  repo_name: z.string().optional(),
  repo_remote_url: RepoRemoteUrlSchema.optional(),
  branch_name: z.string().optional(),
  // The desktop's mirror of the work item's primary lane PR (plan 2026-09-26
  // P8). Null clears it: promoting a lane with no PR leaves the item with none.
  pr_url: z.string().nullable().optional(),
  pr_number: z.number().nullable().optional(),
  // Optimistic-concurrency precondition (ARCH-3b): when present, the update
  // only applies if it still matches the row's current version_number — see
  // the CAS comment on PATCH /:id in work-items.ts. Absent entirely on an old client
  // (or a client patching a work item it never fetched a version for) falls
  // back to today's blind last-write-wins, unchanged.
  expected_version: z.number().int().optional(),
});
