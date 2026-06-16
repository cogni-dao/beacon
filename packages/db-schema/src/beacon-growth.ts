// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/db-schema/beacon-growth`
 * Purpose: Operational substrate for beacon's growth loop v0 (Twitter + Moltbook, text-only).
 *   Three tables back the PRODUCE→BROADCAST→MEASURE arc: configured channel accounts,
 *   per-platform broadcast variants, and append-only cached engagement snapshots.
 * Scope: Drizzle `pgTable` definitions only. No queries, business logic, or I/O.
 * Invariants:
 *   - No RLS in V0 — the growth worker/ingest path uses a service-role connection
 *     (follows the `attribution.ts` precedent: "No RLS in V0 — worker uses service-role connection").
 *     A `tenant_id`/owner column is intentionally NOT added in v0; when RLS lands, add a
 *     node-scoped owner column + policies in a forward migration (see attribution.ts NODE_SCOPED).
 *   - BROADCAST_IDEA_KEY_GROUPS: `broadcasts.idea_key` groups per-platform variants of one core idea.
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
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

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
    channel: text("channel").notNull(),
    handle: text("handle"),
    credentialRef: text("credential_ref"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("channel_accounts_channel_check", sql`${table.channel} IN ('x', 'moltbook')`),
  ]
);

// ---------------------------------------------------------------------------
// broadcasts — per-platform post variants (draft→approve→post lifecycle)
// ---------------------------------------------------------------------------

/**
 * broadcasts — per-platform post variants staged by the content loop.
 * `idea_key` groups the variants of one core idea across channels; `campaign_id`
 * ties them to a campaign hypothesis. `status` is the draft→approve→post lifecycle.
 */
export const broadcasts = pgTable(
  "broadcasts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: text("campaign_id").notNull(),
    ideaKey: text("idea_key").notNull(),
    angle: text("angle"),
    channel: text("channel").notNull(),
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
      sql`${table.status} IN ('drafted', 'approved', 'posted', 'failed')`
    ),
    index("broadcasts_campaign_idx").on(table.campaignId),
    index("broadcasts_idea_key_idx").on(table.ideaKey),
  ]
);

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
      table.capturedAt
    ),
  ]
);
