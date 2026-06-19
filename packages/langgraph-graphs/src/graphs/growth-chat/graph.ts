// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/growth-chat/graph`
 * Purpose: Marketing-strategist agent graph factory with recall-only knowledge tools.
 * Scope: Creates a LangGraph ReAct agent with a playbook-grounded marketing prompt.
 *   Does NOT execute graphs or read env.
 * Invariants:
 *   - Pure factory function — no side effects, no env reads.
 *   - LLM and tools are injected, not instantiated.
 *   - TYPE_TRANSPARENT_RETURN: No explicit return type annotation to preserve
 *     CompiledStateGraph for CLI schema extraction.
 * Side-effects: none
 * Links: COGNI_BRAIN_SPEC.md, LANGGRAPH_AI.md
 * @public
 */

import { MessagesAnnotation } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

import type { CreateReactAgentGraphOptions } from "../types";
import { GROWTH_CHAT_SYSTEM_PROMPT } from "./prompts";

/**
 * Graph name constant for routing.
 */
export const GROWTH_CHAT_GRAPH_NAME = "growth-chat" as const;

/**
 * Create the growth-chat marketing-strategist agent graph.
 *
 * Single ReAct agent with recall-only knowledge tools (knowledge_search /
 * knowledge_read). The system prompt instructs it to recall the seeded campaign
 * playbook from Doltgres before advising on funnel/voice/hooks/cadence/metric.
 *
 * NOTE: Return type is intentionally NOT annotated to preserve the concrete
 * CompiledStateGraph type for LangGraph CLI schema extraction.
 *
 * @param opts - Options with LLM and tools.
 * @returns Compiled LangGraph ready for invoke().
 */
export function createGrowthChatGraph(opts: CreateReactAgentGraphOptions) {
  const { llm, tools } = opts;

  return createReactAgent({
    llm,
    tools: [...tools], // Spread readonly array to mutable for LangGraph
    messageModifier: GROWTH_CHAT_SYSTEM_PROMPT,
    stateSchema: MessagesAnnotation,
  });
}
