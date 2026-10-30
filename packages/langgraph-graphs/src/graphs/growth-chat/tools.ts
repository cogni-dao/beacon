// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/growth-chat/tools`
 * Purpose: Tool IDs for the growth-chat marketing-strategist graph.
 * Scope: Exports tool capability metadata. Does NOT enforce policy (that's ToolRunner's job).
 * Invariants:
 *   - SINGLE_SOURCE_OF_TRUTH: This is THE list of tools growth-chat can use.
 *   - RECALL_ONLY: knowledge READ + SEARCH only — NO knowledge_write, repo, or schedule.
 *     The strategist recalls the seeded campaign playbook; it does not mutate it.
 *   - CAPABILITY_NOT_POLICY: These are capabilities, not authorization.
 * Side-effects: none
 * Links: COGNI_BRAIN_SPEC.md, TOOL_USE_SPEC.md
 * @public
 */

import { KNOWLEDGE_READ_NAME, KNOWLEDGE_SEARCH_NAME } from "@cogni/ai-tools";

/**
 * Tool IDs for the growth-chat graph.
 * Single source of truth — imported by server.ts, cogni-exec.ts, and catalog.ts.
 *
 * Recall-focused: the marketing strategist reads the seeded campaign playbook
 * (beacon-brand-voice / beacon-campaigns / beacon-post-performance) and never writes.
 */
export const GROWTH_CHAT_TOOL_IDS = [
  KNOWLEDGE_SEARCH_NAME,
  KNOWLEDGE_READ_NAME,
] as const;

/**
 * Type for growth-chat tool IDs.
 */
export type GrowthChatToolId = (typeof GROWTH_CHAT_TOOL_IDS)[number];
