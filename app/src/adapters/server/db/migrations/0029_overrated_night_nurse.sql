CREATE TABLE "broadcasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" text NOT NULL,
	"idea_key" text NOT NULL,
	"angle" text,
	"channel" text NOT NULL,
	"text" text NOT NULL,
	"status" text DEFAULT 'drafted' NOT NULL,
	"external_post_id" text,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "broadcasts_status_check" CHECK ("broadcasts"."status" IN ('drafted', 'approved', 'posted', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "channel_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"handle" text,
	"credential_ref" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_accounts_channel_check" CHECK ("channel_accounts"."channel" IN ('x', 'moltbook'))
);
--> statement-breakpoint
CREATE TABLE "post_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"broadcast_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"impressions" integer,
	"likes" integer,
	"reposts" integer,
	"replies" integer,
	"followers_at_capture" integer
);
--> statement-breakpoint
ALTER TABLE "post_metrics" ADD CONSTRAINT "post_metrics_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broadcasts_campaign_idx" ON "broadcasts" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "broadcasts_idea_key_idx" ON "broadcasts" USING btree ("idea_key");--> statement-breakpoint
CREATE INDEX "post_metrics_broadcast_captured_idx" ON "post_metrics" USING btree ("broadcast_id","captured_at");