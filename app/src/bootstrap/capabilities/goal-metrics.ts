// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@bootstrap/capabilities/goal-metrics`
 * Purpose: Node composition of the published goal-metric engine.
 * Scope: Binds this node's id. Calculators, budgets and the source allow-list
 *   are published in @cogni-dao/metrics/knowledge.
 * Side-effects: none (factory only)
 * @public
 */

import {
  createGoalProgressReader,
  createGoalMetrics as createPublishedGoalMetrics,
  createGoalSource,
} from "@cogni-dao/metrics/knowledge";
import type { Sql } from "postgres";
import { getNodeId } from "@/shared/config";

export { createGoalProgressReader, createGoalSource };

export function createGoalMetrics(deps: {
  knowledgeSql: Sql;
  observationsSql: Sql;
  environment: string;
  log(event: object): void;
}) {
  return createPublishedGoalMetrics({ ...deps, node: getNodeId() });
}
