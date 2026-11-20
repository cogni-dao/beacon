// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@/bootstrap/write-attribution`
 * Purpose: The host's one builder of a `WriteAttribution` for a write made through a route (hub activity-attribution, task.0133).
 * Scope: Host composition. A route builds one from the authenticated caller; no request field feeds it.
 * Invariants: HOST_BUILDS_IT, ACTOR_IS_THE_CALLER (a route write has no requester and no run).
 * Side-effects: none
 * @public
 */

import type { WriteAttribution } from "@cogni/work-items";

/** A write made through a route: the authenticated caller. No requester, no run. */
export function routeAttribution(callerUserId: string): WriteAttribution {
  return { actor: callerUserId };
}
