// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/social/x.adapter`
 * Purpose: X (Twitter) API v2 adapter implementing SocialXCapability.
 * Scope: Transport to X API v2 (post tweet + read public_metrics). Does NOT define tool contracts.
 * Invariants:
 *   - AUTH_VIA_ADAPTER: Bearer token resolved from config, never from context
 *   - X_API_PINNED_V2: Uses the v2 client surface only (X_API_VERSION)
 *   - STRUCTURED_RESULTS: Returns Zod-shaped PostContentResult / PostMetricSnapshot[]
 *   - HARD_CAPS_ENFORCED: text ≤280; metrics batched ≤100 ids per X v2 lookup
 *   - NO_SECRETS_IN_LOGS: never logs the bearer token or post bodies
 * Side-effects: IO (HTTPS requests to api.x.com via twitter-api-v2)
 * Links: docs/spec/beacon-growth-loop-v0.md §5
 * @internal
 */

import type {
  PostContentInput,
  PostContentResult,
  PostMetricSnapshot,
  SocialXCapability,
} from "@cogni/ai-tools";
import { X_API_VERSION, X_MAX_TEXT_LENGTH } from "@cogni/ai-tools";
import { TwitterApi } from "twitter-api-v2";

import { EVENT_NAMES, makeLogger } from "@/shared/observability";

const logger = makeLogger({ component: "XSocialAdapter" });

/** X v2 lookup tolerates at most 100 ids per `tweets` call. */
const MAX_METRICS_BATCH = 100;

/**
 * Configuration for XSocialAdapter.
 */
export interface XSocialConfig {
  /** X API v2 bearer token (app-only auth). */
  bearerToken: string;
  /** Request timeout in milliseconds (default: 10000). */
  timeoutMs?: number;
}

/**
 * X (Twitter) API v2 adapter implementing SocialXCapability.
 *
 * Per AUTH_VIA_ADAPTER: the bearer token is resolved from config at
 * construction, never passed in post/read parameters.
 */
export class XSocialAdapter implements SocialXCapability {
  private readonly client: TwitterApi;
  private readonly timeoutMs: number;

  constructor(config: XSocialConfig) {
    // X_API_PINNED_V2: assert the pin so a future major bump is a conscious change.
    if (X_API_VERSION !== "2") {
      throw new Error(`XSocialAdapter requires X API v2, got "${X_API_VERSION}"`);
    }
    this.client = new TwitterApi(config.bearerToken);
    this.timeoutMs = config.timeoutMs ?? 10000;
  }

  async postContent(input: PostContentInput): Promise<PostContentResult> {
    if (input.channel !== "x") {
      throw new Error(
        `XSocialAdapter only handles channel "x", got "${input.channel}"`
      );
    }
    // Hard cap mirrored from the capability boundary (defense in depth).
    const text = input.text.slice(0, X_MAX_TEXT_LENGTH);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.client.v2.tweet(text);
      return {
        externalId: res.data.id,
        postedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logError("post_failed", error);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async readMetrics(
    externalIds: readonly string[]
  ): Promise<PostMetricSnapshot[]> {
    if (externalIds.length === 0) return [];
    // Hard cap: never exceed the X v2 lookup batch limit.
    const ids = externalIds.slice(0, MAX_METRICS_BATCH);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.client.v2.tweets(ids as string[], {
        "tweet.fields": ["public_metrics"],
      });
      const fetchedAt = new Date().toISOString();
      const data = res.data ?? [];
      return data.map((t): PostMetricSnapshot => {
        const m = t.public_metrics;
        // X free-tier hides impressions; surface it only when present so the
        // KPI can fall back to engagement-per-follower (spec §5).
        const impressions = m?.impression_count;
        return {
          externalId: t.id,
          channel: "x",
          likes: m?.like_count ?? 0,
          reposts: m?.retweet_count ?? 0,
          replies: m?.reply_count ?? 0,
          fetchedAt,
          ...(typeof impressions === "number" ? { impressions } : {}),
        };
      });
    } catch (error) {
      this.logError("read_metrics_failed", error);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private logError(reasonCode: string, error: unknown): void {
    const isAbort = error instanceof Error && error.name === "AbortError";
    logger.error(
      {
        event: EVENT_NAMES.ADAPTER_X_ERROR,
        dep: "x",
        reasonCode: isAbort ? "timeout" : reasonCode,
        ...(isAbort ? { durationMs: this.timeoutMs } : {}),
      },
      EVENT_NAMES.ADAPTER_X_ERROR
    );
  }
}
