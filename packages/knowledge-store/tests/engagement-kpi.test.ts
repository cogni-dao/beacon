// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/knowledge-store/tests/engagement-kpi`
 * Purpose: Unit tests for the pure VERIFIER `computeEngagementKpi`.
 * Scope: Tests only. Exercises score independence (no hypothesis confidence
 *   leaks in), impression vs follower fallback, normalization vs target,
 *   validates/invalidates boundary, and empty/budget-deadline invalidation.
 * Side-effects: none
 * Links: docs/spec/beacon-growth-loop-v0.md §5
 * @internal
 */

import { describe, expect, it } from "vitest";
import {
  computeEngagementKpi,
  type PostMetricSnapshot,
} from "../src/domain/engagement-kpi.js";

function snap(partial: Partial<PostMetricSnapshot>): PostMetricSnapshot {
  return {
    impressions: null,
    likes: 0,
    reposts: 0,
    replies: 0,
    followersAtCapture: null,
    ...partial,
  };
}

describe("computeEngagementKpi — engagement-rate (impressions) basis", () => {
  it("rate = (likes+reposts+replies)/impressions, normalized vs target", () => {
    // 30 engagements / 1000 impressions = 0.03 = 3% vs 3% target → score 100.
    const r = computeEngagementKpi(
      [snap({ impressions: 1000, likes: 10, reposts: 10, replies: 10 })],
      { rate: 0.03 }
    );
    expect(r.basis).toBe("impressions");
    expect(r.observedRate).toBeCloseTo(0.03, 6);
    expect(r.score0to100).toBe(100);
    expect(r.edge).toBe("validates");
  });

  it("aggregates as Σnumerators/Σdenominators (weighted, not mean-of-rates)", () => {
    // Post A: 1/1000 = 0.001; Post B: 99/1000 = 0.099. Weighted: 100/2000 = 0.05.
    const r = computeEngagementKpi(
      [
        snap({ impressions: 1000, likes: 1 }),
        snap({ impressions: 1000, likes: 99 }),
      ],
      { rate: 0.05 }
    );
    expect(r.observedRate).toBeCloseTo(0.05, 6);
    expect(r.score0to100).toBe(100);
    expect(r.edge).toBe("validates");
  });

  it("below target invalidates; above target clamps at 100 and validates", () => {
    const low = computeEngagementKpi(
      [snap({ impressions: 1000, likes: 10 })], // 1% vs 4% target → 25
      { rate: 0.04 }
    );
    expect(low.score0to100).toBe(25);
    expect(low.edge).toBe("invalidates");

    const high = computeEngagementKpi(
      [snap({ impressions: 1000, likes: 200 })], // 20% vs 4% target → 500 → clamp 100
      { rate: 0.04 }
    );
    expect(high.score0to100).toBe(100);
    expect(high.edge).toBe("validates");
  });

  it("respects passFraction at the validates boundary", () => {
    // 2% observed vs 4% target → score 50.
    const snaps = [snap({ impressions: 1000, likes: 20 })];
    expect(computeEngagementKpi(snaps, { rate: 0.04 }).edge).toBe("invalidates");
    expect(
      computeEngagementKpi(snaps, { rate: 0.04, passFraction: 0.5 }).edge
    ).toBe("validates");
    expect(
      computeEngagementKpi(snaps, { rate: 0.04, passFraction: 0.51 }).edge
    ).toBe("invalidates");
  });
});

describe("computeEngagementKpi — engagement-per-follower fallback", () => {
  it("falls back when impressions are absent (X free-tier)", () => {
    // 50 engagements / 1000 followers = 0.05 vs 0.05 target → 100.
    const r = computeEngagementKpi(
      [snap({ likes: 20, reposts: 20, replies: 10, followersAtCapture: 1000 })],
      { rate: 0.05 }
    );
    expect(r.basis).toBe("followers");
    expect(r.observedRate).toBeCloseTo(0.05, 6);
    expect(r.score0to100).toBe(100);
    expect(r.edge).toBe("validates");
  });

  it("prefers impressions when present even if followers also present", () => {
    const r = computeEngagementKpi(
      [
        snap({
          impressions: 1000,
          likes: 30,
          followersAtCapture: 10, // would inflate per-follower wildly if used
        }),
      ],
      { rate: 0.03 }
    );
    expect(r.basis).toBe("impressions");
    expect(r.observedRate).toBeCloseTo(0.03, 6);
  });

  it("treats impressions=0 as absent and falls back to followers", () => {
    const r = computeEngagementKpi(
      [snap({ impressions: 0, likes: 50, followersAtCapture: 1000 })],
      { rate: 0.05 }
    );
    expect(r.basis).toBe("followers");
    expect(r.score0to100).toBe(100);
  });
});

describe("computeEngagementKpi — empty / budget-deadline invalidation", () => {
  it("empty snapshots → score 0, invalidates (failed appointment with truth)", () => {
    const r = computeEngagementKpi([], { rate: 0.03 });
    expect(r.score0to100).toBe(0);
    expect(r.basis).toBe("none");
    expect(r.edge).toBe("invalidates");
    expect(r.totalEngagements).toBe(0);
  });

  it("no impressions and no followers → 0, invalidates even with engagements", () => {
    const r = computeEngagementKpi(
      [snap({ likes: 100, reposts: 100, replies: 100 })],
      { rate: 0.03 }
    );
    expect(r.score0to100).toBe(0);
    expect(r.basis).toBe("none");
    expect(r.edge).toBe("invalidates");
    expect(r.totalEngagements).toBe(300);
  });
});

describe("computeEngagementKpi — SCORE INDEPENDENCE (KPI_NEVER_SELF_CITED)", () => {
  it("score is a pure function of snapshots+target — no hypothesis confidence input exists", () => {
    // The function signature literally cannot accept a hypothesis row or its
    // confidence. Identical snapshots/target always yield identical results,
    // regardless of any external state.
    const snaps = [snap({ impressions: 2000, likes: 40, reposts: 20 })];
    const a = computeEngagementKpi(snaps, { rate: 0.03 });
    const b = computeEngagementKpi(snaps, { rate: 0.03 });
    expect(b).toEqual(a);
    // 60/2000 = 0.03 → 100.
    expect(a.score0to100).toBe(100);
  });

  it("is monotonic in observed engagement at fixed impressions+target", () => {
    const target = { rate: 0.05 } as const;
    const s1 = computeEngagementKpi(
      [snap({ impressions: 1000, likes: 10 })],
      target
    ).score0to100;
    const s2 = computeEngagementKpi(
      [snap({ impressions: 1000, likes: 20 })],
      target
    ).score0to100;
    const s3 = computeEngagementKpi(
      [snap({ impressions: 1000, likes: 40 })],
      target
    ).score0to100;
    expect(s1).toBeLessThan(s2);
    expect(s2).toBeLessThan(s3);
  });
});
