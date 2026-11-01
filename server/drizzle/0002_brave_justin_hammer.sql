DROP INDEX "idx_artifact_versions_artifact";--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "uq_artifact_versions_artifact_version" UNIQUE("artifact_id","version_number");