ALTER TABLE "broadcasts" ADD COLUMN "funnel_layer" text DEFAULT 'tofu' NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "topic" text;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "kind" text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "bundle_id" text;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "broadcasts_funnel_layer_idx" ON "broadcasts" USING btree ("funnel_layer");--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_funnel_layer_check" CHECK ("broadcasts"."funnel_layer" IN ('tofu', 'mofu', 'bofu'));--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_kind_check" CHECK ("broadcasts"."kind" IN ('text', 'thread', 'image', 'video'));