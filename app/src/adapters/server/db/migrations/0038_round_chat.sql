ALTER TABLE "connections" DROP CONSTRAINT "connections_status_check";--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "metrics_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "metrics_fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_status_check" CHECK ("connections"."status" IN ('active', 'needs_reauth', 'expired', 'review_pending', 'needs_billing', 'rate_limited'));