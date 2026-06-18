CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"title" text NOT NULL,
	"brief" text,
	"target_rate" real,
	"status" text DEFAULT 'draft' NOT NULL,
	"evaluate_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_status_check" CHECK ("campaigns"."status" IN ('draft', 'active', 'paused', 'done'))
);
--> statement-breakpoint
ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_account_id_billing_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_account_campaign_id_idx" ON "campaigns" USING btree ("account_id","campaign_id");--> statement-breakpoint
CREATE INDEX "campaigns_account_idx" ON "campaigns" USING btree ("account_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "campaigns" AS PERMISSIVE FOR ALL TO public USING ("account_id" IN (SELECT "id" FROM "billing_accounts" WHERE "owner_user_id" = current_setting('app.current_user_id', true))) WITH CHECK ("account_id" IN (SELECT "id" FROM "billing_accounts" WHERE "owner_user_id" = current_setting('app.current_user_id', true)));--> statement-breakpoint
-- FORCE so the table owner is also subject to RLS (drizzle-kit emits ENABLE only;
-- FORCE is outside its DDL model — mirrors 0031_glorious_warlock.sql / 0004_enable_rls.sql).
ALTER TABLE "campaigns" FORCE ROW LEVEL SECURITY;