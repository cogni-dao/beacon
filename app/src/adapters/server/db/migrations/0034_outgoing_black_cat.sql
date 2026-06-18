CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"kind" text NOT NULL,
	"content" text NOT NULL,
	"source_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "findings_kind_check" CHECK ("findings"."kind" IN ('insight', 'pain_point', 'angle', 'exemplar', 'reference'))
);
--> statement-breakpoint
ALTER TABLE "findings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- HAND-APPENDED: drizzle-kit emits ENABLE only; FORCE is outside its DDL model.
-- Without FORCE the table owner (the migration app role) bypasses its own RLS —
-- tests pass while production leaks. Mirror 0031/0033.
ALTER TABLE "findings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_account_id_billing_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "findings_account_idx" ON "findings" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "findings_campaign_idx" ON "findings" USING btree ("campaign_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "findings" AS PERMISSIVE FOR ALL TO public USING ("account_id" IN (SELECT "id" FROM "billing_accounts" WHERE "owner_user_id" = current_setting('app.current_user_id', true))) WITH CHECK ("account_id" IN (SELECT "id" FROM "billing_accounts" WHERE "owner_user_id" = current_setting('app.current_user_id', true)));