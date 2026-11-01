CREATE TABLE "agent_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"work_item_id" text NOT NULL,
	"kind" text DEFAULT 'chat' NOT NULL,
	"communication" text DEFAULT 'pty' NOT NULL,
	"agent_provider_id" text,
	"title" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_sessions_work_item" ON "agent_sessions" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "idx_messages_session" ON "chat_messages" USING btree ("session_id");