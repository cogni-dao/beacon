// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/observability/events`
 * Purpose: Beacon-local event-name registry layered on the shared node registry.
 * Scope: Event names only. Runtime logging lives in `@shared/observability/server`.
 * Invariants: Route/feature events added here unless they are shared across nodes.
 * Side-effects: none
 * @public
 */

import { EVENT_NAMES as NODE_SHARED_EVENT_NAMES } from "@cogni/node-shared";

export const EVENT_NAMES = {
  ...NODE_SHARED_EVENT_NAMES,
  DB_POOL_CONFIGURED: "adapter.db_pool.configured",
  // Auth perimeter (proxy): request rejected before reaching any route handler,
  // so the request-scoped logger never sees it — emitted directly from the proxy.
  AUTH_PERIMETER_DENIED: "auth.perimeter.denied",
  ADAPTER_MOLTBOOK_ERROR: "adapter.moltbook.error",
  GROWTH_CAMPAIGN_GENERATE_COMPLETE: "growth.campaign.generate.complete",
  GROWTH_CAMPAIGN_POST_UPDATE_COMPLETE: "growth.campaign.post_update.complete",
  GROWTH_CAMPAIGN_PUBLISH_APPROVED_COMPLETE:
    "growth.campaign.publish_approved.complete",
  // /admin/payments money-plane snapshot: one terminal event per page read
  // (outcome success|error, durationMs, worst grade, per-plane grade enums).
  MONEY_PLANE_SNAPSHOT: "money_plane.snapshot",
  // Goal metrics (@cogni-dao/metrics): one terminal event per refresh dispatch / goals read.
  METRIC_REFRESH_COMPLETE: "metric.refresh_complete",
  GOALS_PROGRESS_READ: "goals.progress_read",
  // Row history reads (task.0052): one terminal event per read, counts only.
  WORK_ITEMS_HISTORY_READ: "work.items.history_read",
  KNOWLEDGE_HISTORY_READ: "knowledge.history_read",
  // Bounded work reads (task.0056): one terminal event per /work/summaries or /work/board request.
  WORK_ITEMS_LIST_COMPLETE: "work.items.list_complete",
  // The EDO expectations read behind a work item's Metrics card (story.0033): one terminal event per request.
  WORK_EXPECTATIONS_READ: "work.expectations.read",
} as const;

export type EventName = (typeof EVENT_NAMES)[keyof typeof EVENT_NAMES];
