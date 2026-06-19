// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/packages/langgraph-graphs/growth-generate-graph`
 * Purpose: Unit-test the growth-generate CATALOG GRAPH seam — prove the GENERATE
 *   activity is now a dashboard-visible, schedulable catalog graph (per
 *   docs/guides/node-temporal.md). Asserts the factory compiles to a runnable graph,
 *   "growth-generate" is registered in LANGGRAPH_GRAPH_IDS + LANGGRAPH_CATALOG with the
 *   stable graphId `langgraph:growth-generate`, and the scheduler-core registration
 *   builder produces the right shape (graphId + workflowType "GraphRunWorkflow").
 * Scope: Pure compile/shape assertions — no LLM call, no Temporal, no DB, no network.
 *   The graph node is NOT invoked (that would need a live LLM); we only prove it
 *   compiles and the seams line up. Live cron wiring is the app/operator's job.
 * Invariants:
 *   - WRAPS_DO_NOT_REWRITE: the factory returns a compiled StateGraph (a runnable).
 *   - STABLE_GRAPH_NAME: the catalog name is EXACTLY "growth-generate".
 *   - STABLE_GRAPH_ID: graphId resolves to `langgraph:growth-generate` in both
 *     LANGGRAPH_GRAPH_IDS and the scheduler-core registration (the shared seam).
 *   - SCHEDULE_SHAPE: the builder targets GraphRunWorkflow + the catalog graphId.
 *   - GRAPHID_PARITY: the langgraph catalog id and the scheduler-core literal agree.
 * Side-effects: none
 * Links: packages/langgraph-graphs/src/graphs/growth-generate/graph.ts,
 *        packages/scheduler-core/src/services/growthGenerateSchedule.ts,
 *        docs/guides/node-temporal.md
 * @internal
 */

import {
  buildGrowthGenerateScheduleParams,
  GROWTH_GENERATE_DEFAULT_CRON,
  GROWTH_GENERATE_GRAPH_ID,
  GROWTH_GENERATE_SCHEDULE_ID,
} from "@cogni/scheduler-core";
import {
  createGrowthGenerateGraph,
  GROWTH_GENERATE_GRAPH_NAME,
  GROWTH_GENERATE_TOOL_IDS,
  LANGGRAPH_CATALOG,
  LANGGRAPH_GRAPH_IDS,
} from "@cogni/langgraph-graphs";
import { describe, expect, it } from "vitest";

/** Minimal fake LLM — the factory narrows it but never invokes it at build time. */
const fakeLlm = {
  invoke: async () => ({ content: "[]" }),
} as never;

describe("growth-generate catalog graph", () => {
  describe("catalog registration", () => {
    it("is registered in LANGGRAPH_CATALOG under the stable name", () => {
      const entry = LANGGRAPH_CATALOG[GROWTH_GENERATE_GRAPH_NAME];
      expect(entry).toBeDefined();
      expect(GROWTH_GENERATE_GRAPH_NAME).toBe("growth-generate");
      expect(entry?.displayName).toBe("Growth Generate");
      expect(typeof entry?.graphFactory).toBe("function");
      expect(entry?.graphFactory).toBe(createGrowthGenerateGraph);
    });

    it("has no tool surface (NO_TOOLS_V0)", () => {
      const entry = LANGGRAPH_CATALOG[GROWTH_GENERATE_GRAPH_NAME];
      expect(GROWTH_GENERATE_TOOL_IDS).toEqual([]);
      expect(entry?.toolIds).toEqual([]);
    });

    it("exposes graphId `langgraph:growth-generate` in LANGGRAPH_GRAPH_IDS", () => {
      expect(LANGGRAPH_GRAPH_IDS["growth-generate"]).toBe(
        "langgraph:growth-generate"
      );
    });
  });

  describe("factory compiles", () => {
    it("returns a runnable compiled graph", () => {
      const graph = createGrowthGenerateGraph({ llm: fakeLlm, tools: [] });
      expect(graph).toBeDefined();
      expect(typeof graph.invoke).toBe("function");
    });
  });

  describe("scheduler-core registration", () => {
    const params = buildGrowthGenerateScheduleParams({
      nodeId: "node-test",
      ownerUserId: "00000000-0000-4000-a000-000000000001",
      executionGrantId: "grant-test",
      input: { strategy: { campaignId: "demo", brief: "ground here" } },
    });

    it("targets GraphRunWorkflow on the stable graphId", () => {
      expect(params.workflowType).toBe("GraphRunWorkflow");
      expect(params.graphId).toBe("langgraph:growth-generate");
      expect(params.graphId).toBe(GROWTH_GENERATE_GRAPH_ID);
    });

    it("graphId is in lockstep with the langgraph catalog seam", () => {
      // The shared seam: scheduler-core's literal must equal the catalog's id.
      expect(GROWTH_GENERATE_GRAPH_ID).toBe(
        LANGGRAPH_GRAPH_IDS["growth-generate"]
      );
    });

    it("uses skip overlap + no catchup (at-most-once dispatch)", () => {
      expect(params.overlapPolicy).toBe("skip");
      expect(params.catchupWindowMs).toBe(0);
      expect(params.scheduleId).toBe(GROWTH_GENERATE_SCHEDULE_ID);
      expect(params.cron).toBe(GROWTH_GENERATE_DEFAULT_CRON);
    });

    it("passes the caller-supplied substrate bits through", () => {
      expect(params.nodeId).toBe("node-test");
      expect(params.executionGrantId).toBe("grant-test");
      expect(params.input).toEqual({
        strategy: { campaignId: "demo", brief: "ground here" },
      });
    });
  });
});
