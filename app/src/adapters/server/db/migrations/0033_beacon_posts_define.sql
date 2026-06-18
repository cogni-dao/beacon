-- beacon growth-loop "define" step: rename `broadcasts` → `posts`, add the
-- review-lane lifecycle + score/revision, rename the `post_metrics` FK to it,
-- and add the campaign strategy/autonomy fields.
--
-- HAND-AUTHORED (not drizzle-gen): drizzle-kit can't detect a table rename
-- non-interactively — it would DROP `broadcasts` + CREATE `posts`, destroying
-- the RLS policy + FK + data. A rename preserves all of that. Mirrors the
-- hand-authored fallback in the schema-update skill + 0031/0034 FORCE pattern.

-- 1) Rename the table. The PK, the `tenant_isolation` POLICY, and RLS state
--    follow the table OID automatically; named constraints/indexes do not.
ALTER TABLE "broadcasts" RENAME TO "posts";--> statement-breakpoint

-- 2) Rename the broadcasts-prefixed constraints + indexes to posts-prefixed.
ALTER TABLE "posts" RENAME CONSTRAINT "broadcasts_account_id_billing_accounts_id_fk" TO "posts_account_id_billing_accounts_id_fk";--> statement-breakpoint
ALTER TABLE "posts" RENAME CONSTRAINT "broadcasts_funnel_layer_check" TO "posts_funnel_layer_check";--> statement-breakpoint
ALTER TABLE "posts" RENAME CONSTRAINT "broadcasts_kind_check" TO "posts_kind_check";--> statement-breakpoint
ALTER INDEX "broadcasts_campaign_idx" RENAME TO "posts_campaign_idx";--> statement-breakpoint
ALTER INDEX "broadcasts_idea_key_idx" RENAME TO "posts_idea_key_idx";--> statement-breakpoint
ALTER INDEX "broadcasts_funnel_layer_idx" RENAME TO "posts_funnel_layer_idx";--> statement-breakpoint
ALTER INDEX "broadcasts_account_idx" RENAME TO "posts_account_idx";--> statement-breakpoint

-- 3) New post columns: optional pre-post quality score + revision counter.
ALTER TABLE "posts" ADD COLUMN "score" real;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

-- 4) Status default 'drafted' → 'generated'; swap the CHECK to the review lanes.
--    Migrate any existing 'drafted' rows to the new default first.
UPDATE "posts" SET "status" = 'generated' WHERE "status" = 'drafted';--> statement-breakpoint
ALTER TABLE "posts" ALTER COLUMN "status" SET DEFAULT 'generated';--> statement-breakpoint
ALTER TABLE "posts" DROP CONSTRAINT "broadcasts_status_check";--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_status_check" CHECK ("posts"."status" IN ('generated', 'in_review', 'approved', 'posted', 'rejected', 'failed'));--> statement-breakpoint

-- 5) post_metrics: rename the FK column broadcast_id → post_id, its index, + the
--    FK constraint (now pointing at the renamed `posts` table by OID).
ALTER TABLE "post_metrics" RENAME COLUMN "broadcast_id" TO "post_id";--> statement-breakpoint
ALTER TABLE "post_metrics" RENAME CONSTRAINT "post_metrics_broadcast_id_broadcasts_id_fk" TO "post_metrics_post_id_posts_id_fk";--> statement-breakpoint
ALTER INDEX "post_metrics_broadcast_captured_idx" RENAME TO "post_metrics_post_captured_idx";--> statement-breakpoint

-- 6) campaigns: strategy fields + autonomy gate.
ALTER TABLE "campaigns" ADD COLUMN "voice" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "core_topic" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "icp" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "objective" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "funnel_targets" jsonb;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "autonomy" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_autonomy_check" CHECK ("campaigns"."autonomy" IN ('manual', 'approve_gate', 'autonomous'));--> statement-breakpoint

-- 7) FORCE RLS on the renamed table. The rename preserves ENABLE + FORCE state
--    on the OID, but re-assert FORCE explicitly to mirror 0031/0034 (drizzle
--    emits ENABLE only; FORCE is outside its DDL model). Idempotent.
ALTER TABLE "posts" FORCE ROW LEVEL SECURITY;
