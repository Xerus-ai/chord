CREATE TABLE "agent_permission_requests" (
	"request_id" text PRIMARY KEY NOT NULL,
	"work_item_id" text NOT NULL,
	"session_id" text,
	"tool_name" text NOT NULL,
	"input" jsonb NOT NULL,
	"options" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolved_by" text,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commands" (
	"id" text PRIMARY KEY NOT NULL,
	"work_item_id" text NOT NULL,
	"session_id" text,
	"issuer_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"status_reason" text,
	"claimed_by_device" text,
	"claimed_at" timestamp with time zone,
	"acked_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "approval_policy" text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "delivery_policy" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_permission_requests" ADD CONSTRAINT "agent_permission_requests_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_permission_requests" ADD CONSTRAINT "agent_permission_requests_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commands" ADD CONSTRAINT "commands_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commands" ADD CONSTRAINT "commands_issuer_id_users_id_fk" FOREIGN KEY ("issuer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_permission_requests_work_item" ON "agent_permission_requests" USING btree ("work_item_id","status");--> statement-breakpoint
CREATE INDEX "idx_commands_work_item_status" ON "commands" USING btree ("work_item_id","status","id");