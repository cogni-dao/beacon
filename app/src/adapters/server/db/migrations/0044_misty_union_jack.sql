CREATE TABLE "campaign_current_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"run_id" uuid,
	"summary" text NOT NULL,
	"next_action" text NOT NULL,
	"confidence" real DEFAULT 0.3 NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_current_state_confidence_check" CHECK ("campaign_current_state"."confidence" >= 0 AND "campaign_current_state"."confidence" <= 1)
);
--> statement-breakpoint
ALTER TABLE "campaign_current_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_current_state" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "campaign_intelligence_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"trigger" text DEFAULT 'manual_refresh' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"error_code" text,
	"model_ref" text,
	"source_counts" jsonb,
	"finding_count" integer DEFAULT 0 NOT NULL,
	"recommendation_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "campaign_intelligence_runs_status_check" CHECK ("campaign_intelligence_runs"."status" IN ('running', 'completed', 'failed')),
	CONSTRAINT "campaign_intelligence_runs_trigger_check" CHECK ("campaign_intelligence_runs"."trigger" IN ('manual_refresh', 'heartbeat', 'agent'))
);
--> statement-breakpoint
ALTER TABLE "campaign_intelligence_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_intelligence_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "campaign_post_priorities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"run_id" uuid,
	"rank" integer NOT NULL,
	"score" real NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"funnel_layer" text DEFAULT 'tofu' NOT NULL,
	"topic" text,
	"angle" text,
	"premise" text NOT NULL,
	"justification" text NOT NULL,
	"kpi_metric" text DEFAULT 'qualified_engagement_rate' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_post_priorities_status_check" CHECK ("campaign_post_priorities"."status" IN ('proposed', 'selected', 'generated', 'dismissed')),
	CONSTRAINT "campaign_post_priorities_layer_check" CHECK ("campaign_post_priorities"."funnel_layer" IN ('tofu', 'mofu', 'bofu')),
	CONSTRAINT "campaign_post_priorities_score_check" CHECK ("campaign_post_priorities"."score" >= 0 AND "campaign_post_priorities"."score" <= 1)
);
--> statement-breakpoint
ALTER TABLE "campaign_post_priorities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_post_priorities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_current_state" ADD CONSTRAINT "campaign_current_state_account_id_billing_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_current_state" ADD CONSTRAINT "campaign_current_state_run_id_campaign_intelligence_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."campaign_intelligence_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_intelligence_runs" ADD CONSTRAINT "campaign_intelligence_runs_account_id_billing_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_post_priorities" ADD CONSTRAINT "campaign_post_priorities_account_id_billing_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_post_priorities" ADD CONSTRAINT "campaign_post_priorities_run_id_campaign_intelligence_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."campaign_intelligence_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_current_state_account_campaign_idx" ON "campaign_current_state" USING btree ("account_id","campaign_id");--> statement-breakpoint
CREATE INDEX "campaign_current_state_campaign_idx" ON "campaign_current_state" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaign_intelligence_runs_campaign_idx" ON "campaign_intelligence_runs" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaign_intelligence_runs_account_idx" ON "campaign_intelligence_runs" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "campaign_post_priorities_campaign_idx" ON "campaign_post_priorities" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaign_post_priorities_account_idx" ON "campaign_post_priorities" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "campaign_post_priorities_run_idx" ON "campaign_post_priorities" USING btree ("run_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "campaign_current_state" AS PERMISSIVE FOR ALL TO public USING ("account_id" IN (SELECT "id" FROM "billing_accounts" WHERE "owner_user_id" = current_setting('app.current_user_id', true))) WITH CHECK ("account_id" IN (SELECT "id" FROM "billing_accounts" WHERE "owner_user_id" = current_setting('app.current_user_id', true)));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "campaign_intelligence_runs" AS PERMISSIVE FOR ALL TO public USING ("account_id" IN (SELECT "id" FROM "billing_accounts" WHERE "owner_user_id" = current_setting('app.current_user_id', true))) WITH CHECK ("account_id" IN (SELECT "id" FROM "billing_accounts" WHERE "owner_user_id" = current_setting('app.current_user_id', true)));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "campaign_post_priorities" AS PERMISSIVE FOR ALL TO public USING ("account_id" IN (SELECT "id" FROM "billing_accounts" WHERE "owner_user_id" = current_setting('app.current_user_id', true))) WITH CHECK ("account_id" IN (SELECT "id" FROM "billing_accounts" WHERE "owner_user_id" = current_setting('app.current_user_id', true)));
