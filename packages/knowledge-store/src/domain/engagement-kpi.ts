// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/knowledge-store/domain/engagement-kpi`
 * Purpose: Pure, independent VERIFIER — `computeEngagementKpi(snapshots, target)`
 *   scores a campaign's cached engagement against a target and emits a
 *   validates/invalidates edge. No LLM, no API, no DB; the hypothesis row's own
 *   confidence is NEVER an input (WORKER≠VERIFIER / KPI_NEVER_SELF_CITED).
 * Scope: Pure functions + Zod schemas only. Does not read Postgres, the
 *   knowledge store, or any I/O. The bridge job supplies snapshots loaded from
 *   `post_metrics` and persists the resulting edge via the resolver.
 * Invariants:
 *   - KPI_NEVER_SELF_CITED: the edge derives solely from the supplied snapshots
 *     + target. The hypothesis's confidence is not, and cannot be, an argument.
 *   - ENGAGEMENT_RATE_PRIMARY: when impressions are present (and > 0) the rate is
 *     (likes+reposts+replies)/impressions.
 *   - ENGAGEMENT_PER_FOLLOWER_FALLBACK: when impressions are absent/zero across
 *     a snapshot, fall back to (likes+reposts+replies)/followers_at_capture
 *     (X free-tier hides impressions — spec §5).
 *   - SCORE_NORMALIZED_0_100: the aggregate rate is normalized vs the target so a
 *     campaign that hits target scores 100; the edge validates iff score >= 100*PASS_FRACTION.
 *   - EMPTY_SNAPSHOTS_INVALIDATE: no measured engagement at the budget deadline
 *     is a failed hypothesis (score 0, invalidates).
 * Side-effects: none (pure)
 * Links: docs/spec/beacon-growth-loop-v0.md §5, .context/specs/pr3-verifier.md
 * @public
 */

import { z } from "zod";

import type { ResolutionEdge } from "../port/edo-resolver.port.js";

/**
 * One cached engagement snapshot for a single broadcast at a single capture
 * time. Mirrors the durable `post_metrics` row but is deliberately decoupled
 * from any Drizzle/Postgres type so this module stays plane-agnostic and
 * unit-testable without a DB. `impressions` and `followersAtCapture` are
 * nullable: X free-tier hides impressions, and some channels omit follower
 * counts.
 */
export const PostMetricSnapshotSchema = z.object({
  impressions: z.number().int().nonnegative().nullable(),
  likes: z.number().int().nonnegative(),
  reposts: z.number().int().nonnegative(),
  replies: z.number().int().nonnegative(),
  followersAtCapture: z.number().int().nonnegative().nullable(),
});
export type PostMetricSnapshot = z.infer<typeof PostMetricSnapshotSchema>;

/**
 * The verification target for a campaign: the engagement RATE (a fraction, e.g.
 * 0.02 = 2%) the hypothesis predicted it would hit. The KPI normalizes the
 * observed rate against this target.
 */
export const EngagementTargetSchema = z.object({
  /** Target engagement rate as a fraction in (0, 1], e.g. 0.02 = 2%. */
  rate: z.number().positive().max(1),
  /**
   * Fraction of the target (0..1] the campaign must reach to `validates`.
   * Default 1.0 (must hit target). A campaign at half the target validates
   * iff `passFraction <= 0.5`.
   */
  passFraction: z.number().positive().max(1).default(1),
});
export type EngagementTarget = z.input<typeof EngagementTargetSchema>;

/**
 * Which basis produced the observed rate — surfaced for explainability so the
 * outcome row can record whether the score is impression-based or the
 * follower-based fallback (or that nothing was measured).
 */
export type EngagementBasis = "impressions" | "followers" | "none";

/**
 * Result of `computeEngagementKpi`. `score0to100` is the observed rate
 * normalized vs target and clamped to 0..100; `edge` is the
 * validates/invalidates verdict.
 */
export interface EngagementKpiResult {
  /** Observed engagement normalized vs target, clamped to 0..100. */
  score0to100: number;
  /** Verdict for the resolver. */
  edge: ResolutionEdge;
  /** The observed aggregate engagement rate (fraction), before normalization. */
  observedRate: number;
  /** Which denominator basis produced `observedRate`. */
  basis: EngagementBasis;
  /** Total engagements (likes+reposts+replies) summed across snapshots. */
  totalEngagements: number;
}

function engagementsOf(s: PostMetricSnapshot): number {
  return s.likes + s.reposts + s.replies;
}

function clamp0to100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

/**
 * Compute the campaign engagement KPI from cached snapshots.
 *
 * Aggregation is sum-of-numerators over sum-of-denominators (a weighted mean,
 * not a mean-of-rates), so high-impression posts dominate appropriately:
 *   - PRIMARY: rate = Σ(likes+reposts+replies) / Σ(impressions)  [impressions > 0]
 *   - FALLBACK: rate = Σ(likes+reposts+replies) / Σ(followers)   [no impressions]
 *
 * The rate is normalized vs `target.rate` to a 0..100 score (target → 100) and
 * the edge `validates` iff `score >= 100 * passFraction`. Empty input — or all
 * denominators zero/absent — scores 0 and `invalidates` (a failed appointment
 * with truth at the budget deadline).
 *
 * PURE: depends only on its arguments. The hypothesis's own confidence is never
 * an input (KPI_NEVER_SELF_CITED).
 */
export function computeEngagementKpi(
  snapshots: readonly PostMetricSnapshot[],
  target: EngagementTarget
): EngagementKpiResult {
  const { rate: targetRate, passFraction } = EngagementTargetSchema.parse(target);

  let totalEngagements = 0;
  let totalImpressions = 0;
  let totalFollowers = 0;
  let anyImpressions = false;

  for (const raw of snapshots) {
    const s = PostMetricSnapshotSchema.parse(raw);
    totalEngagements += engagementsOf(s);
    if (s.impressions !== null && s.impressions > 0) {
      totalImpressions += s.impressions;
      anyImpressions = true;
    }
    if (s.followersAtCapture !== null && s.followersAtCapture > 0) {
      totalFollowers += s.followersAtCapture;
    }
  }

  let observedRate = 0;
  let basis: EngagementBasis = "none";
  if (anyImpressions && totalImpressions > 0) {
    observedRate = totalEngagements / totalImpressions;
    basis = "impressions";
  } else if (totalFollowers > 0) {
    // X free-tier fallback: engagement-per-follower (spec §5).
    observedRate = totalEngagements / totalFollowers;
    basis = "followers";
  } else {
    // Nothing measurable — failed appointment with truth.
    return {
      score0to100: 0,
      edge: "invalidates",
      observedRate: 0,
      basis: "none",
      totalEngagements,
    };
  }

  const score0to100 = clamp0to100((observedRate / targetRate) * 100);
  const edge: ResolutionEdge =
    score0to100 >= 100 * passFraction ? "validates" : "invalidates";

  return { score0to100, edge, observedRate, basis, totalEngagements };
}
