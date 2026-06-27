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
  // Auth perimeter (proxy): request rejected before reaching any route handler,
  // so the request-scoped logger never sees it — emitted directly from the proxy.
  AUTH_PERIMETER_DENIED: "auth.perimeter.denied",
  ADAPTER_MOLTBOOK_ERROR: "adapter.moltbook.error",
  GROWTH_CAMPAIGN_GENERATE_COMPLETE: "growth.campaign.generate.complete",
  GROWTH_CAMPAIGN_POST_UPDATE_COMPLETE: "growth.campaign.post_update.complete",
  GROWTH_CAMPAIGN_PUBLISH_APPROVED_COMPLETE:
    "growth.campaign.publish_approved.complete",
} as const;

export type EventName = (typeof EVENT_NAMES)[keyof typeof EVENT_NAMES];
