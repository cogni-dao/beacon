// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/db-schema/beacon-growth`
 * Purpose: Operational substrate for beacon's growth loop v0 (Twitter + Moltbook, text-only).
 *   Three tables back the PRODUCE→BROADCAST→MEASURE arc: configured channel accounts,
 *   per-platform broadcast variants, and append-only cached engagement snapshots.
 * Scope: Drizzle `pgTable` definitions only. No queries, business logic, or I/O.
 * Invariants:
 *   - ACCOUNT_SCOPED: every row carries `account_id` (FK → `billing_accounts`), the
 *     tenancy axis. RLS is enabled here (`.enableRLS()` emits ENABLE; the POLICY + FORCE
 *     are hand-authored in the migration — see `0004_enable_rls.sql`/`0025_add_connections.sql`).
 *     The `tenant_isolation` policy scopes rows to billing accounts the session user owns
 *     (`current_setting('app.current_user_id', true)`). Worker/ingest JOBS use a service-role
 *     connection (bypasses RLS) and write account-scoped rows from row one; user-facing
 *     `/growth` reads go through the RLS-respecting tenant-scope client.
 *   - BROADCAST_IDEA_KEY_GROUPS: `broadcasts.idea_key` groups per-platform variants of one core idea.
 *   - BROADCAST_FUNNEL_CLASSIFIED: each broadcast carries its funnel layer (tofu/mofu/bofu)
 *     + topic so the queue is a classified funnel, not one blended stream (CHECK-bounded here).
 *   - BROADCAST_KIND_RESERVED: `kind` is text-only in v0; thread/image/video reserved for
 *     bundles/artifacts (no blob storage yet). `bundle_id`/`seq` reserve ordered tweet-chains.
 *   - BROADCAST_LIFECYCLE: `status` walks drafted→approved→posted (or failed) — enforced by the app, CHECK-bounded here.
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
	pgPolicy,
	pgTable,
	text,
	timestamp,
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
// broadcasts — per-platform post variants (draft→approve→post lifecycle)
// ---------------------------------------------------------------------------

/**
 * broadcasts — per-platform post variants staged by the content loop.
 * `idea_key` groups the variants of one core idea across channels; `campaign_id`
 * ties them to a campaign hypothesis. `status` is the draft→approve→post lifecycle.
 * `funnel_layer` + `topic` classify the post within the campaign funnel (the queue
 * is a planned, classified funnel — not one blended stream). `kind`/`bundle_id`/`seq`
 * reserve future thread/artifact/tweet-chain extensions (text-only single posts in v0).
 */
export const broadcasts = pgTable(
	"broadcasts",
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
		status: text("status").notNull().default("drafted"),
		externalPostId: text("external_post_id"),
		postedAt: timestamp("posted_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		check(
			"broadcasts_status_check",
			sql`${table.status} IN ('drafted', 'approved', 'posted', 'failed')`,
		),
		check(
			"broadcasts_funnel_layer_check",
			sql`${table.funnelLayer} IN ('tofu', 'mofu', 'bofu')`,
		),
		check(
			"broadcasts_kind_check",
			sql`${table.kind} IN ('text', 'thread', 'image', 'video')`,
		),
		index("broadcasts_campaign_idx").on(table.campaignId),
		index("broadcasts_idea_key_idx").on(table.ideaKey),
		index("broadcasts_funnel_layer_idx").on(table.funnelLayer),
		index("broadcasts_account_idx").on(table.accountId),
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
 * post_metrics — append-only engagement snapshots for a broadcast (POST_METRICS_APPEND_ONLY).
 * Written ONLY by the metrics ingest path; never mutated. `impressions` may be null on
 * X free-tier (the KPI falls back to engagement-per-follower — see spec §5).
 */
export const postMetrics = pgTable(
	"post_metrics",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		/** Owning billing account (tenancy axis), stamped from the parent broadcast. */
		accountId: text("account_id")
			.notNull()
			.references(() => billingAccounts.id, { onDelete: "cascade" }),
		broadcastId: uuid("broadcast_id")
			.notNull()
			.references(() => broadcasts.id),
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
		index("post_metrics_broadcast_captured_idx").on(
			table.broadcastId,
			table.capturedAt,
		),
		index("post_metrics_account_idx").on(table.accountId),
		pgPolicy("tenant_isolation", {
			using: accountOwnershipPredicate,
			withCheck: accountOwnershipPredicate,
		}),
	],
).enableRLS();
