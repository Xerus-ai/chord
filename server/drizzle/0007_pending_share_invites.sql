ALTER TABLE "share_tokens" ADD COLUMN "invited_email" text;--> statement-breakpoint
CREATE INDEX "idx_share_tokens_invited_email" ON "share_tokens" USING btree ("invited_email");
