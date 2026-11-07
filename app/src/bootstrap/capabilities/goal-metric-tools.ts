// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@bootstrap/capabilities/goal-metric-tools`
 * Purpose: Bind the published metric tool implementations to this node's services.
 * Scope: Injects the node's one goal-progress reader so the HTTP route and
 *   core__goal_progress share it.
 * Side-effects: none (factory only)
 * @public
 */

import { createMetricTools } from "@cogni/shared-ai-tools";
import type { GoalsProgress, MetricService } from "@cogni-dao/metrics";

export function createGoalMetricTools(deps: {
  metrics: () => MetricService | undefined;
  goalProgress: () => Promise<GoalsProgress>;
}) {
  return createMetricTools(deps.metrics, { goalProgress: deps.goalProgress });
}
