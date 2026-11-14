// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/content/tools`
 * Purpose: Tool IDs for the content production graph (single source of truth).
 * Scope: Exports the tool capability list. Does NOT enforce policy (ToolRunner's job).
 * Invariants:
 *   - SINGLE_SOURCE_OF_TRUTH: THE list of tools the content graph may use
 *   - CAPABILITY_NOT_POLICY: these are capabilities, not authorization
 *   - NO_POST_METRICS_WRITE: the content graph never gains a post_metrics write surface
 * Side-effects: none
 * Links: https://github.com/cogni-dao/cogni/blob/2321821e61dd12aa0cf75d235bd668ff65739109/docs/spec/tool-use.md, https://beacon.cognidao.org/knowledge/growth-loop-contract
 * @public
 */

import { BROADCAST_POST_NAME } from "@cogni/beacon-ai-tools";

/**
 * Tool IDs for the content graph.
 *
 * The graph itself produces staged per-channel variants (no I/O). The broadcast
 * tool is exposed so an operator can ask the agent to broadcast the staged
 * variants in the same session. The content graph never references the metrics
 * ingest path (WORKER≠VERIFIER).
 */
export const CONTENT_TOOL_IDS = [BROADCAST_POST_NAME] as const;

/**
 * Type for content tool IDs.
 */
export type ContentToolId = (typeof CONTENT_TOOL_IDS)[number];
