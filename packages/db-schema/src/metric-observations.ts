// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@cogni/db-schema/metric-observations`
 * Purpose: Operational goal-metric evidence tables, defined once in the published @cogni-dao/metrics package.
 * Scope: Re-exports only. Migrations and pool ownership stay node-local.
 * Side-effects: none
 * @public
 */

export {
  knowledgeCitePairs,
  knowledgeReadDaily,
  metricObservations,
  metricRefreshCursors,
} from "@cogni-dao/metrics/schema";
