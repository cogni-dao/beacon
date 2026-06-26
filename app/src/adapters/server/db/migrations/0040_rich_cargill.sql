CREATE TABLE "post_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"post_id" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"action" text NOT NULL,
	"score" real,
	"rank" integer,
	"reason" text,
	"model_ref" text,
	CONSTRAINT "post_decisions_action_check" CHECK ("post_decisions"."action" IN ('ranked', 'approved', 'rejected', 'posted'))
);
--> statement-breakpoint
ALTER TABLE "post_decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY "tenant_isolation" ON "channel_accounts" CASCADE;--> statement-breakpoint
DROP TABLE "channel_accounts" CASCADE;--> statement-breakpoint
ALTER TABLE "post_decisions" ADD CONSTRAINT "post_decisions_account_id_billing_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_decisions" ADD CONSTRAINT "post_decisions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_decisions_post_idx" ON "post_decisions" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "post_decisions_campaign_idx" ON "post_decisions" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "post_decisions_account_idx" ON "post_decisions" USING btree ("account_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "post_decisions" AS PERMISSIVE FOR ALL TO public USING ("account_id" IN (SELECT "id" FROM "billing_accounts" WHERE "owner_user_id" = current_setting('app.current_user_id', true))) WITH CHECK ("account_id" IN (SELECT "id" FROM "billing_accounts" WHERE "owner_user_id" = current_setting('app.current_user_id', true)));--> statement-breakpoint
ALTER TABLE "post_decisions" FORCE ROW LEVEL SECURITY;
