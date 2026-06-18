// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/invariants/worker-not-verifier-post-metrics`
 * Purpose: Tripwire test for the WORKER≠VERIFIER invariant of the beacon growth
 *   loop — the content/broadcast (worker) path must have NO `post_metrics` write
 *   surface. The metrics-ingest job is the SOLE `post_metrics` writer.
 * Scope: Structural source-scan (no dependency-cruiser in repo) of the worker-path
 *   modules + a schema-shape check on the broadcast tool. Does NOT verify runtime.
 * Invariants:
 *   - NO_POST_METRICS_WRITE: worker-path modules don't reference the post_metrics
 *     table name or the ingest writer symbols (in executable code).
 *   - SOLE_POST_METRICS_WRITER: only the ingest job/route reference the writer.
 *   - BROADCAST_OUTPUT_HAS_NO_METRICS: the broadcast tool exposes no engagement fields.
 * Side-effects: none (read-only file scan)
 * Links: docs/spec/beacon-growth-loop-v0.md §1/§5
 * @internal
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import {
  BroadcastPostOutputSchema,
  broadcastPostContract,
} from "@cogni/ai-tools";
import { describe, expect, it } from "vitest";

// process.cwd() is the app/ dir under vitest; repo root is one level up.
const REPO_ROOT = path.resolve(process.cwd(), "..");

/** Tokens that would indicate a `post_metrics` write surface leaked into the worker path. */
const FORBIDDEN_TOKENS = [
  "post_metrics",
  "postMetrics",
  "ingestPostMetrics",
  "runIngestPostMetricsJob",
] as const;

/**
 * Worker-path modules that must NEVER reference the post_metrics writer.
 * Repo-root-relative.
 */
const WORKER_PATH_MODULES = [
  "packages/ai-tools/src/tools/broadcast-post.ts",
  "packages/ai-tools/src/capabilities/broadcast.ts",
  "packages/langgraph-graphs/src/graphs/content/graph.ts",
  "packages/langgraph-graphs/src/graphs/content/tools.ts",
  "packages/langgraph-graphs/src/graphs/content/state.ts",
  "app/src/bootstrap/capabilities/broadcast.ts",
] as const;

/**
 * The sole writer modules — these SHOULD reference post_metrics (sanity anchor so
 * the guard fails loudly if the ingest path is renamed/removed).
 */
const SOLE_WRITER_MODULES = [
  "app/src/bootstrap/jobs/ingestPostMetrics.job.ts",
] as const;

/**
 * Strip line/block comments so the guard reflects executable dependencies, not
 * prose. (Module headers legitimately mention the invariant by name; only real
 * code references should fail the guard.)
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/\/\/.*$/gm, ""); // line comments
}

function readCode(relPath: string): string {
  return stripComments(readFileSync(path.join(REPO_ROOT, relPath), "utf8"));
}

describe("WORKER≠VERIFIER: content/broadcast path has no post_metrics write surface", () => {
  for (const relPath of WORKER_PATH_MODULES) {
    it(`${relPath} does not reference the post_metrics writer (in code)`, () => {
      const code = readCode(relPath);
      for (const token of FORBIDDEN_TOKENS) {
        expect(
          code.includes(token),
          `${relPath} must not reference "${token}" — ingest is the sole post_metrics writer`
        ).toBe(false);
      }
    });
  }

  it("the metrics-ingest job IS the post_metrics writer (sanity anchor)", () => {
    for (const relPath of SOLE_WRITER_MODULES) {
      const code = readCode(relPath);
      expect(
        code.includes("postMetrics"),
        `${relPath} should write postMetrics — it is the sole writer`
      ).toBe(true);
    }
  });

  it("broadcast tool output schema exposes no engagement-metric fields", () => {
    const keys = Object.keys(BroadcastPostOutputSchema.shape);
    expect(keys).toEqual(["ideaKey", "results"]);

    const serialized = JSON.stringify(broadcastPostContract.allowlist);
    for (const metricField of [
      "likes",
      "reposts",
      "replies",
      "impressions",
      "followers",
    ]) {
      expect(serialized.includes(metricField)).toBe(false);
    }
  });
});
