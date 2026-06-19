// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/growth-generate/tools`
 * Purpose: Tool IDs for the growth-generate catalog graph (single source of truth).
 * Scope: Exports the tool capability list. Does NOT enforce policy (ToolRunner's job).
 * Invariants:
 *   - SINGLE_SOURCE_OF_TRUTH: THE list of tools the growth-generate graph may use.
 *   - NO_TOOLS_V0: generate is a pure single-shot LLM composition (one call per funnel
 *     layer inside `runGrowthGenerate`) — it has no tool surface. Persistence as `posts`
 *     is the caller's job, never the graph's.
 * Side-effects: none
 * Links: ./graph.ts, ../content/tools.ts, TOOL_USE_SPEC.md
 * @public
 */

/**
 * Tool IDs for the growth-generate graph. Empty: the graph populates the funnel via
 * pure LLM calls and emits drafts on state — it never reaches for a tool.
 */
export const GROWTH_GENERATE_TOOL_IDS = [] as const;

/** Type for growth-generate tool IDs. */
export type GrowthGenerateToolId = (typeof GROWTH_GENERATE_TOOL_IDS)[number];
