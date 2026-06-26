// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO
/**
 * Module: `@tests/unit/packages/langgraph-graphs/default-graph`
 * Purpose: The neutral `default` graph the chatCompletion facade falls back to
 *   (`langgraph:default`) must be registered — its absence caused growth
 *   generate/research to fail `not_found` → 500 on candidate.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import {
  LANGGRAPH_CATALOG,
  LANGGRAPH_GRAPH_IDS,
} from "@cogni/langgraph-graphs";

describe("default graph registration (facade fallback)", () => {
  it("exposes langgraph:default in GRAPH_IDS", () => {
    expect(LANGGRAPH_GRAPH_IDS.default).toBe("langgraph:default");
  });
  it("registers a neutral default catalog entry (no tools)", () => {
    const entry = LANGGRAPH_CATALOG.default;
    expect(entry).toBeDefined();
    expect(typeof entry.graphFactory).toBe("function");
    expect(entry.toolIds).toEqual([]);
  });
});
