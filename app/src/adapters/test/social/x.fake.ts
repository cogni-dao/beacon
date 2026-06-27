// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/test/social/x.fake`
 * Purpose: Fake X SocialXCapability for testing / CI.
 * Scope: Deterministic post + monotonic-rising metrics. Does NOT make network calls.
 * Invariants:
 *   - DETERMINISTIC_RESULTS: same call sequence → same outputs
 *   - NO_NETWORK: never makes actual HTTP requests
 *   - MONOTONIC_RISING_METRICS: engagement grows with readMetrics call-count so a
 *     campaign KPI demonstrably lifts in CI (each readMetrics() is one "tick")
 * Side-effects: none
 * Links: docs/spec/beacon-growth-loop-v0.md §5
 * @internal
 */

import type {
  PostContentInput,
  PostContentResult,
  PostMetricSnapshot,
  SocialXCapability,
} from "@cogni/ai-tools";

/**
 * Fake X capability: deterministic posts, monotonic-rising metrics.
 *
 * `postContent` mints a stable id derived from call order. `readMetrics`
 * returns engagement that rises with each call (the "tick"), so a KPI computed
 * over successive snapshots demonstrably lifts in CI.
 */
export class FakeXSocialAdapter implements SocialXCapability {
  private postCount = 0;
  private readCount = 0;

  async postContent(input: PostContentInput): Promise<PostContentResult> {
    if (input.channel !== "x") {
      throw new Error(
        `FakeXSocialAdapter only handles channel "x", got "${input.channel}"`
      );
    }
    this.postCount++;
    const externalId = `x-fake-${this.postCount}`;
    return {
      externalId,
      url: `https://x.com/i/web/status/${externalId}`,
      // Fixed epoch base + deterministic offset → stable across runs.
      postedAt: new Date(1_700_000_000_000 + this.postCount * 1000).toISOString(),
    };
  }

  async readMetrics(
    externalIds: readonly string[]
  ): Promise<PostMetricSnapshot[]> {
    if (externalIds.length === 0) return [];
    // Each readMetrics() advances the tick; engagement is a function of the
    // tick so successive ingests yield strictly rising counts.
    this.readCount++;
    const tick = this.readCount;
    const fetchedAt = new Date(
      1_700_000_000_000 + tick * 3_600_000
    ).toISOString();

    return externalIds.map((externalId, i): PostMetricSnapshot => {
      // Per-id seed keeps ids distinguishable but deterministic.
      const seed = i + 1;
      return {
        externalId,
        channel: "x",
        impressions: 100 * tick * seed,
        likes: 5 * tick * seed,
        reposts: 2 * tick * seed,
        replies: 1 * tick * seed,
        followers: 1000 + 10 * tick,
        fetchedAt,
      };
    });
  }

  /** Number of readMetrics() ticks so far (test introspection). */
  getReadCount(): number {
    return this.readCount;
  }

  /** Reset counters between test runs. */
  reset(): void {
    this.postCount = 0;
    this.readCount = 0;
  }
}
