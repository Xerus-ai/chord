CREATE TABLE "artifact_version_snapshots" (
	"version_id" text PRIMARY KEY NOT NULL,
	"snapshot" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "yjs_documents" (
	"document_name" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifact_version_snapshots" ADD CONSTRAINT "artifact_version_snapshots_version_id_artifact_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."artifact_versions"("id") ON DELETE cascade ON UPDATE no action;