// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/db-schema/beacon-growth`
 * Purpose: Operational substrate for beacon's growth loop v0 (Moltbook-first).
 *   Tables back the DEFINE→GENERATE→REFINE→POST→ANALYZE arc: the account-owned
 *   campaign RECORD (lifecycle status + targets + strategy fields), configured channel
 *   accounts, the `posts` queue (review-lane statuses), and append-only cached engagement
 *   snapshots. The campaign's KPI is tenant data in Postgres (NOT a Doltgres hypothesis).
 * Scope: Drizzle `pgTable` definitions only. No queries, business logic, or I/O.
 * Invariants:
 *   - ACCOUNT_SCOPED: every row carries `account_id` (FK → `billing_accounts`), the
 *     tenancy axis. RLS is enabled here (`.enableRLS()` emits ENABLE; the POLICY + FORCE
 *     are hand-authored in the migration — see `0004_enable_rls.sql`/`0025_add_connections.sql`).
 *     The `tenant_isolation` policy scopes rows to billing accounts the session user owns
 *     (`current_setting('app.current_user_id', true)`). Worker/ingest JOBS use a service-role
 *     connection (bypasses RLS) and write account-scoped rows from row one; user-facing
 *     `/growth` reads go through the RLS-respecting tenant-scope client.
 *   - CAMPAIGN_RECORD_OWNED: the `campaigns` row is the account-private campaign record
 *     (CRUD-able, lifecycle `status` draft→active→paused→done). `status` is a plain field
 *     that gates the queue — no schedule coupling. Per the SSOT, tenant KPI lives in
 *     Postgres; Doltgres holds only generic playbook knowledge (no tenant data).
 *   - CAMPAIGN_STRATEGY_FIELDS: `voice`/`core_topic`/`icp`/`objective`/`funnel_targets`
 *     carry the generation strategy (brand voice, topic, ideal-customer profile, objective,
 *     per-funnel-layer coverage targets) that later steps consume to drive generation volume
 *     (no hardcoded N). `autonomy` gates how far the loop runs unattended (CHECK-bounded).
 *   - POST_IDEA_KEY_GROUPS: `posts.idea_key` groups per-platform variants of one core idea.
 *   - POST_FUNNEL_CLASSIFIED: each post carries its funnel layer (tofu/mofu/bofu)
 *     + topic so the queue is a classified funnel, not one blended stream (CHECK-bounded here).
 *   - POST_KIND_RESERVED: `kind` is text-only in v0; thread/image/video reserved for
 *     bundles/artifacts (no blob storage yet). `bundle_id`/`seq` reserve ordered tweet-chains.
 *   - POST_LIFECYCLE: `status` walks the review lanes
 *     generated→in_review→approved→posted (or rejected/failed) — enforced by the app,
 *     CHECK-bounded here. `score` is the optional pre-post quality score; `revision`
 *     counts critique→edit passes.
 *   - POST_METRICS_APPEND_ONLY: `post_metrics` is written ONLY by the ingest path; each row is one captured snapshot.
 * Side-effects: none (schema definitions only)
 * Links: docs/spec/beacon-growth-loop-v0.md
 * @public
 */

import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	jsonb,
	pgPolicy,
	pgTable,
	real,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

import { billingAccounts } from "./refs";

/**
 * Account-ownership RLS predicate: a row is visible iff its `account_id` is a
 * billing account the session user owns (GUC `app.current_user_id`, NULL when
 * unset → silent deny). v0 personal = sole-member account; node/org accounts
 * extend this subquery in vFuture. drizzle-kit emits ENABLE + FORCE + the
 * CREATE POLICY from `pgPolicy()` + `.enableRLS()` (no hand-authoring).
 */
const accountOwnershipPredicate = sql`"account_id" IN (SELECT "id" FROM "billing_accounts" WHERE "owner_user_id" = current_setting('app.current_user_id', true))`;

// ---------------------------------------------------------------------------
// campaigns — account-scoped campaign RECORD (the funnel run + targets + status)
// ---------------------------------------------------------------------------

/**
 * campaigns — the account-private campaign record. The campaign HYPOTHESIS still
 * lives in shared Doltgres (the KPI resolver reads it); this is the owned, CRUD-able
 * operational record with a real lifecycle `status` (draft→active→paused→done).
 * `campaign_id` is the slug shared with the Doltgres hypothesis + `posts.campaign_id`
 * — unique per row (one record per campaign). `target_rate` is the predicted engagement
 * rate the funnel must hit. RLS scopes every row to the owning billing account.
 */
export const campaigns = pgTable(
	"campaigns",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		/** Owning billing account (tenancy axis). RLS scopes rows by this FK. */
		accountId: text("account_id")
			.notNull()
			.references(() => billingAccounts.id, { onDelete: "cascade" }),
		/** Campaign slug — shared with the Doltgres hypothesis + `posts.campaign_id`. */
		campaignId: text("campaign_id").notNull(),
		title: text("title").notNull(),
		/** The audience + angle + funnel-stage framing of the campaign; nullable. */
		brief: text("brief"),
		/** Predicted engagement RATE the funnel must hit (fraction in (0,1]); nullable. */
		targetRate: real("target_rate"),
		/** Brand voice / tone the generator writes in; nullable. */
		voice: text("voice"),
		/** The core subject the campaign orbits (seeds idea expansion); nullable. */
		coreTopic: text("core_topic"),
		/** Ideal-customer profile / target audience description; nullable. */
		icp: text("icp"),
		/** What the campaign is trying to achieve (awareness, signups, …); nullable. */
		objective: text("objective"),
		/**
		 * Per-funnel-layer coverage target that drives generation VOLUME (no hardcoded N).
		 * Shape is consumed by later steps (e.g. {"tofu":N,"mofu":N,"bofu":N}); nullable.
		 */
		funnelTargets: jsonb("funnel_targets"),
		/**
		 * How far the loop runs unattended: `manual` (human drives every step),
		 * `approve_gate` (generate freely, human approves before post), `autonomous`
		 * (end-to-end). CHECK-bounded; defaults to the safe `manual`.
		 */
		autonomy: text("autonomy").notNull().default("manual"),
		/**
		 * Lifecycle status: draft (paused) → active (heartbeat runs) → paused → done.
		 * Wiring status→Temporal schedule pause/resume is the HEARTBEAT PR; here it
		 * only persists the field. CHECK-bounded.
		 */
		status: text("status").notNull().default("draft"),
		/** When the campaign hypothesis resolves (budget deadline); nullable. */
		evaluateAt: timestamp("evaluate_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		check(
			"campaigns_status_check",
			sql`${table.status} IN ('draft', 'active', 'paused', 'done')`,
		),
		check(
			"campaigns_autonomy_check",
			sql`${table.autonomy} IN ('manual', 'approve_gate', 'autonomous')`,
		),
		// One record per campaign slug, scoped to its account (slug is account-unique).
		uniqueIndex("campaigns_account_campaign_id_idx").on(
			table.accountId,
			table.campaignId,
		),
		index("campaigns_account_idx").on(table.accountId),
		pgPolicy("tenant_isolation", {
			using: accountOwnershipPredicate,
			withCheck: accountOwnershipPredicate,
		}),
	],
).enableRLS();

// ---------------------------------------------------------------------------
// channel_accounts — configured broadcast channels (X / Moltbook)
// ---------------------------------------------------------------------------

/**
 * channel_accounts — one row per configured broadcast channel account.
 * `credential_ref` points at a secret reference (never the raw credential).
 */
export const channelAccounts = pgTable(
	"channel_accounts",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		/** Owning billing account (tenancy axis). RLS scopes rows by this FK. */
		accountId: text("account_id")
			.notNull()
			.references(() => billingAccounts.id, { onDelete: "cascade" }),
		channel: text("channel").notNull(),
		handle: text("handle"),
		credentialRef: text("credential_ref"),
		enabled: boolean("enabled").notNull().default(true),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		check(
			"channel_accounts_channel_check",
			sql`${table.channel} IN ('x', 'moltbook')`,
		),
		index("channel_accounts_account_idx").on(table.accountId),
		pgPolicy("tenant_isolation", {
			using: accountOwnershipPredicate,
			withCheck: accountOwnershipPredicate,
		}),
	],
).enableRLS();

// ---------------------------------------------------------------------------
// posts — per-platform post variants (review-lane lifecycle)
// ---------------------------------------------------------------------------

/**
 * posts — per-platform post variants staged by the content loop.
 * `idea_key` groups the variants of one core idea across channels; `campaign_id`
 * ties them to a campaign hypothesis. `status` walks the review lanes
 * generated→in_review→approved→posted (or rejected/failed). `score` is the optional
 * pre-post quality score and `revision` counts critique→edit passes.
 * `funnel_layer` + `topic` classify the post within the campaign funnel (the queue
 * is a planned, classified funnel — not one blended stream). `kind`/`bundle_id`/`seq`
 * reserve future thread/artifact/tweet-chain extensions (text-only single posts in v0).
 */
export const posts = pgTable(
	"posts",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		/** Owning billing account (tenancy axis). RLS scopes rows by this FK. */
		accountId: text("account_id")
			.notNull()
			.references(() => billingAccounts.id, { onDelete: "cascade" }),
		campaignId: text("campaign_id").notNull(),
		ideaKey: text("idea_key").notNull(),
		angle: text("angle"),
		channel: text("channel").notNull(),
		/** Funnel position: tofu (awareness) → mofu (consideration) → bofu (action). */
		funnelLayer: text("funnel_layer").notNull().default("tofu"),
		/** Free-text subject this post angles at (e.g. "ownership"); nullable. */
		topic: text("topic"),
		/** Content kind — text-only in v0; thread/image/video reserved (artifacts roadmap). */
		kind: text("kind").notNull().default("text"),
		/** Groups ordered items into one logical post (tweet-chains/threads); null in v0. */
		bundleId: text("bundle_id"),
		/** Position within a bundle; 0 for standalone single posts. */
		seq: integer("seq").notNull().default(0),
		text: text("text").notNull(),
		/** Optional pre-post quality score from the critique pass; nullable. */
		score: real("score"),
		/** Count of critique→edit revision passes; 0 for first draft. */
		revision: integer("revision").notNull().default(0),
		status: text("status").notNull().default("generated"),
		externalPostId: text("external_post_id"),
		postedAt: timestamp("posted_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		check(
			"posts_status_check",
			sql`${table.status} IN ('generated', 'in_review', 'approved', 'posted', 'rejected', 'failed')`,
		),
		check(
			"posts_funnel_layer_check",
			sql`${table.funnelLayer} IN ('tofu', 'mofu', 'bofu')`,
		),
		check(
			"posts_kind_check",
			sql`${table.kind} IN ('text', 'thread', 'image', 'video')`,
		),
		index("posts_campaign_idx").on(table.campaignId),
		index("posts_idea_key_idx").on(table.ideaKey),
		index("posts_funnel_layer_idx").on(table.funnelLayer),
		index("posts_account_idx").on(table.accountId),
		pgPolicy("tenant_isolation", {
			using: accountOwnershipPredicate,
			withCheck: accountOwnershipPredicate,
		}),
	],
).enableRLS();

// ---------------------------------------------------------------------------
// post_metrics — append-only cached engagement snapshots
// ---------------------------------------------------------------------------

/**
 * post_metrics — append-only engagement snapshots for a post (POST_METRICS_APPEND_ONLY).
 * Written ONLY by the metrics ingest path; never mutated. `impressions` may be null on
 * X free-tier (the KPI falls back to engagement-per-follower — see spec §5).
 */
export const postMetrics = pgTable(
	"post_metrics",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		/** Owning billing account (tenancy axis), stamped from the parent post. */
		accountId: text("account_id")
			.notNull()
			.references(() => billingAccounts.id, { onDelete: "cascade" }),
		postId: uuid("post_id")
			.notNull()
			.references(() => posts.id),
		channel: text("channel").notNull(),
		capturedAt: timestamp("captured_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		impressions: integer("impressions"),
		likes: integer("likes"),
		reposts: integer("reposts"),
		replies: integer("replies"),
		followersAtCapture: integer("followers_at_capture"),
	},
	(table) => [
		index("post_metrics_post_captured_idx").on(
			table.postId,
			table.capturedAt,
		),
		index("post_metrics_account_idx").on(table.accountId),
		pgPolicy("tenant_isolation", {
			using: accountOwnershipPredicate,
			withCheck: accountOwnershipPredicate,
		}),
	],
).enableRLS();
