// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/test/social/moltbook.fake`
 * Purpose: Fake Moltbook SocialXCapability for testing / CI.
 * Scope: Deterministic post + monotonic-rising metrics. FAKE-ONLY in v0 (no real adapter).
 * Invariants:
 *   - DETERMINISTIC_RESULTS: same call sequence → same outputs
 *   - NO_NETWORK: never makes actual HTTP requests
 *   - MONOTONIC_RISING_METRICS: engagement grows with readMetrics call-count
 *   - FAKE_ONLY_V0: Moltbook has no verified public API yet — real adapter deferred
 * Side-effects: none
 * Links: docs/spec/beacon-growth-loop-v0.md §2
 * @internal
 */

import type {
  PostContentInput,
  PostContentResult,
  PostMetricSnapshot,
  SocialXCapability,
} from "@cogni/ai-tools";

/**
 * Fake Moltbook capability: deterministic posts, monotonic-rising metrics.
 *
 * Moltbook is fake-only in v0. Engagement scales modestly differently from the
 * X fake so multi-channel KPIs are distinguishable in tests, but still rises
 * strictly with each readMetrics() tick. Moltbook does not expose impressions.
 */
export class FakeMoltbookAdapter implements SocialXCapability {
  private postCount = 0;
  private readCount = 0;

  async postContent(input: PostContentInput): Promise<PostContentResult> {
    if (input.channel !== "moltbook") {
      throw new Error(
        `FakeMoltbookAdapter only handles channel "moltbook", got "${input.channel}"`
      );
    }
    this.postCount++;
    return {
      externalId: `moltbook-fake-${this.postCount}`,
      postedAt: new Date(
        1_700_000_000_000 + this.postCount * 1000
      ).toISOString(),
    };
  }

  async readMetrics(
    externalIds: readonly string[]
  ): Promise<PostMetricSnapshot[]> {
    if (externalIds.length === 0) return [];
    this.readCount++;
    const tick = this.readCount;
    const fetchedAt = new Date(
      1_700_000_000_000 + tick * 3_600_000
    ).toISOString();

    return externalIds.map((externalId, i): PostMetricSnapshot => {
      const seed = i + 1;
      // No `impressions` for Moltbook → KPI falls back to per-follower.
      return {
        externalId,
        channel: "moltbook",
        likes: 4 * tick * seed,
        reposts: 1 * tick * seed,
        replies: 2 * tick * seed,
        followers: 500 + 8 * tick,
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
