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
import { createKnowledgeUsageCalculator } from "@cogni-dao/metrics/usage";
import type { Sql } from "postgres";
import type { MetricsQueryPort } from "@/ports";
import { getNodeId } from "@/shared/config";

export { createGoalProgressReader, createGoalSource };

export function createGoalMetrics(deps: {
  knowledgeSql: Sql;
  observationsSql: Sql;
  environment: string;
  log(event: object): void;
  /** Read by `http.requests@1`; absent reads unknown (`prometheus:not_configured`). */
  metricsQuery?: MetricsQueryPort;
}) {
  const { metricsQuery, ...rest } = deps;
  return createPublishedGoalMetrics({
    ...rest,
    node: getNodeId(),
    ...(metricsQuery
      ? {
          // The operator lane scrape labels every series with node and env (bug.5641), and the
          // node-scoped read proxy confines each query to them (story.5169); no `app` matcher.
          prometheus: { query: metricsQuery },
        }
      : {}),
    nodeCalculators: [createKnowledgeUsageCalculator(deps.observationsSql)],
  });
}
