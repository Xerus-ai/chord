CREATE TABLE "artifact_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"artifact_id" text NOT NULL,
	"parent_comment_id" text,
	"author_id" text NOT NULL,
	"author_name" text NOT NULL,
	"anchor_key" text,
	"anchor_text" text,
	"body" text NOT NULL,
	"resolved" boolean DEFAULT false,
	"resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"artifact_id" text NOT NULL,
	"document_name" text NOT NULL,
	"version_number" integer NOT NULL,
	"author_id" text,
	"author_name" text,
	"label" text,
	"byte_size" integer DEFAULT 0 NOT NULL,
	"trigger" text DEFAULT 'auto' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"work_item_id" text NOT NULL,
	"name" text NOT NULL,
	"content_type" text DEFAULT 'markdown' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'in_progress',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"work_item_id" text NOT NULL,
	"sender_id" text,
	"sender_type" text NOT NULL,
	"sender_name" text,
	"content" text NOT NULL,
	"message_type" text DEFAULT 'text' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"account_name" text,
	"config" jsonb DEFAULT '{}'::jsonb,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_integrations_org_provider" UNIQUE("org_id","provider")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"work_item_id" text,
	"read" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_memberships" (
	"user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	CONSTRAINT "org_memberships_user_id_org_id_pk" PRIMARY KEY("user_id","org_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "presence" (
	"user_id" text NOT NULL,
	"work_item_id" text,
	"status" text DEFAULT 'online' NOT NULL,
	"cursor_position" jsonb,
	"active_view" text,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"work_item_id" text NOT NULL,
	"created_by" text NOT NULL,
	"token" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "team_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"inviter_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_pulse_summaries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"summary" text NOT NULL,
	"pr_refs" jsonb DEFAULT '[]'::jsonb,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "work_item_git_files" (
	"work_item_id" text NOT NULL,
	"path" text NOT NULL,
	"original" text NOT NULL,
	"modified" text NOT NULL,
	CONSTRAINT "work_item_git_files_work_item_id_path_pk" PRIMARY KEY("work_item_id","path")
);
--> statement-breakpoint
CREATE TABLE "work_item_git_state" (
	"work_item_id" text PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"branch_name" text,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_item_participants" (
	"work_item_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'participant' NOT NULL,
	"joined_via_token_id" text,
	CONSTRAINT "work_item_participants_work_item_id_user_id_pk" PRIMARY KEY("work_item_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "work_items" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"creator_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"workflow_phase" text DEFAULT 'build',
	"ticket_id" text,
	"ticket_provider" text,
	"ticket_url" text,
	"pr_number" integer,
	"pr_url" text,
	"repo_name" text,
	"branch_name" text,
	"agent_provider" text,
	"sharing_level" text DEFAULT 'private',
	"version_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_gates" (
	"id" text PRIMARY KEY NOT NULL,
	"stage_id" text NOT NULL,
	"description" text NOT NULL,
	"gate_type" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_stages" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"name" text NOT NULL,
	"stage_order" integer NOT NULL,
	"agent_provider" text,
	"agent_model" text,
	"output_type" text,
	"description" text,
	"config" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"template" text,
	"is_default" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifact_comments" ADD CONSTRAINT "artifact_comments_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_comments" ADD CONSTRAINT "artifact_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_comments" ADD CONSTRAINT "artifact_comments_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence" ADD CONSTRAINT "presence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presence" ADD CONSTRAINT "presence_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_tokens" ADD CONSTRAINT "share_tokens_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_tokens" ADD CONSTRAINT "share_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_pulse_summaries" ADD CONSTRAINT "team_pulse_summaries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_pulse_summaries" ADD CONSTRAINT "team_pulse_summaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_git_files" ADD CONSTRAINT "work_item_git_files_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_git_state" ADD CONSTRAINT "work_item_git_state_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_participants" ADD CONSTRAINT "work_item_participants_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_participants" ADD CONSTRAINT "work_item_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_participants" ADD CONSTRAINT "work_item_participants_joined_via_token_id_share_tokens_id_fk" FOREIGN KEY ("joined_via_token_id") REFERENCES "public"."share_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_gates" ADD CONSTRAINT "workflow_gates_stage_id_workflow_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."workflow_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stages" ADD CONSTRAINT "workflow_stages_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_comments_artifact" ON "artifact_comments" USING btree ("artifact_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_artifact_versions_artifact" ON "artifact_versions" USING btree ("artifact_id","version_number");--> statement-breakpoint
CREATE INDEX "idx_artifacts_work_item" ON "artifacts" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "idx_messages_work_item" ON "chat_messages" USING btree ("work_item_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_notifications_user" ON "notifications" USING btree ("user_id","read","created_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_work_item" ON "notifications" USING btree ("work_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_presence_user_work_item" ON "presence" USING btree ("user_id","work_item_id") WHERE "presence"."work_item_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_presence_user_no_work_item" ON "presence" USING btree ("user_id") WHERE "presence"."work_item_id" is null;--> statement-breakpoint
CREATE INDEX "idx_presence_work_item" ON "presence" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "idx_share_tokens_token" ON "share_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_share_tokens_work_item" ON "share_tokens" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "idx_invites_email" ON "team_invites" USING btree ("email","status");--> statement-breakpoint
CREATE INDEX "idx_pulse_org_period" ON "team_pulse_summaries" USING btree ("org_id","period_end");--> statement-breakpoint
CREATE INDEX "idx_participants_user" ON "work_item_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_participants_token" ON "work_item_participants" USING btree ("joined_via_token_id");