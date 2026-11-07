// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
/** Beacon's host catalog composes the published baseline without changing product tools. */
import { CORE_TOOL_BUNDLE } from "@cogni/ai-tools";
import {
  type CatalogBoundTool,
  METRIC_TOOL_BUNDLE,
  CORE_TOOL_BUNDLE as SHARED_CORE_TOOL_BUNDLE,
} from "@cogni/shared-ai-tools";
export const EVALUATION_TOOL_IDS = [
  "core__goal_list",
  "core__work_item_query",
  "core__work_item_transition",
  "core__knowledge_search",
  "core__knowledge_read",
  "core__knowledge_write",
  "core__edo_hypothesize",
  "core__edo_record_outcome",
  "core__edo_decide",
  "core__get_current_time",
] as const;
const baseline = new Map(
  SHARED_CORE_TOOL_BUNDLE.map((tool) => [tool.contract.name, tool]),
);
const local = new Map<
  string,
  CatalogBoundTool | (typeof CORE_TOOL_BUNDLE)[number]
>(CORE_TOOL_BUNDLE.map((tool) => [tool.contract.name, tool]));
for (const id of EVALUATION_TOOL_IDS) {
  const shared = baseline.get(id);
  if (!shared) throw new Error(`Shared evaluation release is missing ${id}`);
  const existing = local.get(id);
  local.set(id, {
    ...shared,
    contract: { ...existing?.contract, ...shared.contract },
  });
}
/** Published goal-metric tools (core__goal_progress, core__metric_*) over @cogni-dao/metrics. */
export const METRIC_TOOL_IDS: readonly string[] = METRIC_TOOL_BUNDLE.map(
  (tool) => tool.contract.name,
);
for (const tool of METRIC_TOOL_BUNDLE) local.set(tool.contract.name, tool);
/** Tools whose contracts use the published (Zod 4) compiler. */
export const PUBLISHED_TOOL_IDS: readonly string[] = [
  ...EVALUATION_TOOL_IDS,
  ...METRIC_TOOL_IDS,
];
export const BEACON_CORE_TOOL_BUNDLE = [...local.values()];
