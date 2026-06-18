ALTER TABLE "connections" DROP CONSTRAINT "connections_provider_check";--> statement-breakpoint
DROP INDEX "connections_billing_account_provider_active_idx";--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "external_account_id" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "external_handle" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "display_label" text;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "connections_billing_provider_account_active_idx" ON "connections" USING btree ("billing_account_id","provider",COALESCE("external_account_id", '')) WHERE "connections"."revoked_at" IS NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_status_check" CHECK ("connections"."status" IN ('active', 'needs_reauth', 'expired', 'review_pending'));--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_provider_check" CHECK ("connections"."provider" IN ('openai-chatgpt', 'openai-compatible', 'github', 'google', 'bluesky', 'x'));
