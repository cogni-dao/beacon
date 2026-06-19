// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/packages/langgraph-graphs/growth-chat-graph`
 * Purpose: Unit-test the growth-chat CATALOG GRAPH seam — the watchable
 *   marketing-strategist ReAct agent the campaign page's chat panel points at.
 *   Asserts the factory compiles to a runnable graph, "growth-chat" is registered
 *   in LANGGRAPH_CATALOG + LANGGRAPH_GRAPH_IDS with the stable graphId
 *   `langgraph:growth-chat`, and that the catalog entry exposes EXACTLY the two
 *   recall-only knowledge tools (knowledge_search + knowledge_read) with a
 *   playbook-grounded system prompt — and NO write/repo/schedule surface.
 * Scope: Pure compile/shape assertions — no LLM call, no DB, no network. The
 *   graph node is NOT invoked (that needs a live LLM); we only prove it compiles
 *   and the seams line up.
 * Invariants:
 *   - STABLE_GRAPH_NAME: the catalog name is EXACTLY "growth-chat".
 *   - STABLE_GRAPH_ID: graphId resolves to `langgraph:growth-chat`.
 *   - RECALL_ONLY_TOOLS: toolIds are EXACTLY [knowledge_search, knowledge_read].
 *   - GROUNDED_PERSONA: catalog entry carries the marketing-strategist system prompt.
 *   - WRAPS_DO_NOT_REWRITE: the factory returns a runnable compiled graph.
 * Side-effects: none
 * Links: packages/langgraph-graphs/src/graphs/growth-chat/graph.ts,
 *        app/src/app/(app)/growth/_components/CampaignChatPanel.tsx
 * @internal
 */

import { KNOWLEDGE_READ_NAME, KNOWLEDGE_SEARCH_NAME } from "@cogni/ai-tools";
import {
  createGrowthChatGraph,
  GROWTH_CHAT_GRAPH_NAME,
  GROWTH_CHAT_SYSTEM_PROMPT,
  GROWTH_CHAT_TOOL_IDS,
  LANGGRAPH_CATALOG,
  LANGGRAPH_GRAPH_IDS,
} from "@cogni/langgraph-graphs";
import { describe, expect, it } from "vitest";

/** Minimal fake LLM — the factory narrows it but never invokes it at build time. */
const fakeLlm = {
  invoke: async () => ({ content: "ok" }),
} as never;

describe("growth-chat catalog graph", () => {
  describe("catalog registration", () => {
    it("is registered in LANGGRAPH_CATALOG under the stable name", () => {
      const entry = LANGGRAPH_CATALOG[GROWTH_CHAT_GRAPH_NAME];
      expect(entry).toBeDefined();
      expect(GROWTH_CHAT_GRAPH_NAME).toBe("growth-chat");
      expect(entry?.displayName).toBe("Growth Chat");
      expect(typeof entry?.graphFactory).toBe("function");
      expect(entry?.graphFactory).toBe(createGrowthChatGraph);
    });

    it("exposes graphId `langgraph:growth-chat` in LANGGRAPH_GRAPH_IDS", () => {
      expect(LANGGRAPH_GRAPH_IDS["growth-chat"]).toBe("langgraph:growth-chat");
    });

    it("carries the playbook-grounded marketing-strategist system prompt", () => {
      const entry = LANGGRAPH_CATALOG[GROWTH_CHAT_GRAPH_NAME];
      expect(entry?.systemPrompt).toBe(GROWTH_CHAT_SYSTEM_PROMPT);
      // Persona must direct recall over the seeded playbook domains.
      expect(GROWTH_CHAT_SYSTEM_PROMPT).toContain("beacon-brand-voice");
      expect(GROWTH_CHAT_SYSTEM_PROMPT).toContain("knowledge_search");
    });
  });

  describe("recall-only tool surface", () => {
    it("has EXACTLY the two knowledge recall tools", () => {
      expect(GROWTH_CHAT_TOOL_IDS).toEqual([
        KNOWLEDGE_SEARCH_NAME,
        KNOWLEDGE_READ_NAME,
      ]);
      expect(GROWTH_CHAT_TOOL_IDS).toHaveLength(2);
    });

    it("the catalog entry exposes the same two tool IDs (and nothing else)", () => {
      const entry = LANGGRAPH_CATALOG[GROWTH_CHAT_GRAPH_NAME];
      expect(entry?.toolIds).toEqual([
        KNOWLEDGE_SEARCH_NAME,
        KNOWLEDGE_READ_NAME,
      ]);
      // RECALL_ONLY: no write / repo / schedule capabilities leak in.
      const ids = entry?.toolIds ?? [];
      for (const id of ids) {
        expect(id).not.toContain("write");
        expect(id).not.toContain("repo");
        expect(id).not.toContain("schedule");
      }
    });
  });

  describe("factory compiles", () => {
    it("returns a runnable compiled graph", () => {
      const graph = createGrowthChatGraph({ llm: fakeLlm, tools: [] });
      expect(graph).toBeDefined();
      expect(typeof graph.invoke).toBe("function");
    });
  });
});
