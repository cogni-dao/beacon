ALTER TABLE "broadcasts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "channel_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "post_metrics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "account_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_accounts" ADD COLUMN "account_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "post_metrics" ADD COLUMN "account_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_account_id_billing_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_accounts_account_id_billing_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_metrics" ADD CONSTRAINT "post_metrics_account_id_billing_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broadcasts_account_idx" ON "broadcasts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "channel_accounts_account_idx" ON "channel_accounts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "post_metrics_account_idx" ON "post_metrics" USING btree ("account_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "broadcasts" AS PERMISSIVE FOR ALL TO public USING ("account_id" IN (SELECT "id" FROM "billing_accounts" WHERE "owner_user_id" = current_setting('app.current_user_id', true))) WITH CHECK ("account_id" IN (SELECT "id" FROM "billing_accounts" WHERE "owner_user_id" = current_setting('app.current_user_id', true)));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "channel_accounts" AS PERMISSIVE FOR ALL TO public USING ("account_id" IN (SELECT "id" FROM "billing_accounts" WHERE "owner_user_id" = current_setting('app.current_user_id', true))) WITH CHECK ("account_id" IN (SELECT "id" FROM "billing_accounts" WHERE "owner_user_id" = current_setting('app.current_user_id', true)));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "post_metrics" AS PERMISSIVE FOR ALL TO public USING ("account_id" IN (SELECT "id" FROM "billing_accounts" WHERE "owner_user_id" = current_setting('app.current_user_id', true))) WITH CHECK ("account_id" IN (SELECT "id" FROM "billing_accounts" WHERE "owner_user_id" = current_setting('app.current_user_id', true)));--> statement-breakpoint
-- FORCE so the table owner is also subject to RLS (drizzle-kit emits ENABLE only;
-- FORCE is outside its DDL model — mirrors 0004_enable_rls.sql / 0006).
ALTER TABLE "broadcasts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "channel_accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "post_metrics" FORCE ROW LEVEL SECURITY;
