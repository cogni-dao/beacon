// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/default/graph`
 * Purpose: The NEUTRAL completion graph — runs the caller's messages through the
 *   LLM with NO persona prompt and NO tools. This is the graph the `chatCompletion`
 *   facade falls back to (`DEFAULT_GRAPH_NAME = "langgraph:default"`) when a caller
 *   does a plain single-shot completion (growth generate/research supply their own
 *   system+user messages and just need raw completion). beacon's catalog previously
 *   had no `default` graph, so facade callers without a graphName resolved to
 *   `not_found` → 500 (the growth generate/research breakage).
 * Scope: Pure factory. LLM + tools injected; reads no env; runs no I/O.
 * Invariants:
 *   - NEUTRAL: no messageModifier/system prompt — the caller's messages are used
 *     verbatim (do not inject a persona; that would distort caller prompts).
 *   - NO_TOOLS: registered with empty toolIds; a plain completion has no tool loop.
 *   - TYPE_TRANSPARENT_RETURN: no explicit return type (CLI schema extraction).
 * Side-effects: none (the injected LLM does the only I/O)
 * Links: ../poet/graph.ts, src/app/_facades/ai/completion.server.ts (DEFAULT_GRAPH_NAME)
 * @public
 */

import { MessagesAnnotation } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

import type { CreateReactAgentGraphOptions } from "../types";

/** Graph name constant for routing. Fully-qualified id is `langgraph:default`. */
export const DEFAULT_GRAPH_NAME = "default" as const;

/** Tool IDs for the default graph — none; a plain completion uses no tools. */
export const DEFAULT_TOOL_IDS = [] as const;

/**
 * Create the neutral completion graph: a React agent with no tools and no
 * messageModifier, so it returns the LLM's response to the caller's messages
 * verbatim — a plain single-shot completion through the billed executor path.
 */
export function createDefaultGraph(opts: CreateReactAgentGraphOptions) {
  const { llm } = opts;
  return createReactAgent({
    llm,
    tools: [],
    stateSchema: MessagesAnnotation,
  });
}
