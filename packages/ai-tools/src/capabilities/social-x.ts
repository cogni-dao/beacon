// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/capabilities/social-x`
 * Purpose: Social broadcast + metrics-read capability for the beacon growth loop.
 * Scope: Defines SocialXCapability (post content, read engagement metrics) + Zod
 *   boundary schemas. Does NOT implement transport (X API / Moltbook live in adapters).
 * Invariants:
 *   - NO_SECRETS_IN_CONTEXT: Capability resolves auth, never stored in context
 *   - STRUCTURED_RESULTS: Returns typed, Zod-validated post results + metric snapshots
 *   - X_API_PINNED_V2: The X transport is pinned to API v2 (X_API_VERSION const)
 *   - METRIC_INTS_NONNEGATIVE: All engagement counts are ints ≥ 0
 * Side-effects: none (interface + schemas only)
 * Links: docs/spec/beacon-growth-loop-v0.md §5
 * @public
 */

import { z } from "zod";

/**
 * Pinned X API version. The real adapter targets X API v2 `public_metrics`.
 * Per X_API_PINNED_V2: never silently follow X to a newer major version.
 */
export const X_API_VERSION = "2" as const;

/**
 * Broadcast channels supported in growth-loop v0.
 * `x` = X/Twitter (real adapter, env-gated). `moltbook` = fake-only in v0.
 */
export const SOCIAL_CHANNELS = ["x", "moltbook"] as const;
export type SocialChannel = (typeof SOCIAL_CHANNELS)[number];

/**
 * Hard cap on X post length (characters). Enforced at the capability boundary.
 */
export const X_MAX_TEXT_LENGTH = 280 as const;

/**
 * Input for posting one piece of content to one channel.
 * Per-channel text is pre-adapted by the content graph; `idempotencyKey`
 * lets adapters dedupe retries.
 */
export const PostContentInputSchema = z
  .object({
    channel: z.enum(SOCIAL_CHANNELS).describe("Target broadcast channel"),
    text: z.string().min(1).describe("The post body (per-channel adapted)"),
    idempotencyKey: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe("Stable key to dedupe retried posts"),
  })
  .superRefine((val, ctx) => {
    // Channel-specific hard caps live at the boundary so every adapter inherits them.
    if (val.channel === "x" && val.text.length > X_MAX_TEXT_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        maximum: X_MAX_TEXT_LENGTH,
        type: "string",
        inclusive: true,
        path: ["text"],
        message: `X posts must be ≤ ${X_MAX_TEXT_LENGTH} characters`,
      });
    }
  });
export type PostContentInput = z.infer<typeof PostContentInputSchema>;

/**
 * Result of a successful post.
 */
export const PostContentResultSchema = z.object({
  externalId: z.string().min(1).describe("Channel-native post id"),
  postedAt: z.string().datetime().describe("ISO-8601 post timestamp"),
});
export type PostContentResult = z.infer<typeof PostContentResultSchema>;

/**
 * One cached engagement snapshot for a posted item.
 * `impressions` is optional: X free-tier hides it, so the KPI falls back to
 * engagement-per-follower (spec §5). All counts are non-negative integers.
 */
export const PostMetricSnapshotSchema = z.object({
  externalId: z.string().min(1).describe("Channel-native post id"),
  channel: z.enum(SOCIAL_CHANNELS).describe("Channel the snapshot came from"),
  impressions: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Impressions (absent on X free-tier)"),
  likes: z.number().int().min(0).describe("Like count"),
  reposts: z.number().int().min(0).describe("Repost/retweet count"),
  replies: z.number().int().min(0).describe("Reply count"),
  followers: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Author follower count at capture (for per-follower KPI fallback)"),
  fetchedAt: z.string().datetime().describe("ISO-8601 capture timestamp"),
});
export type PostMetricSnapshot = z.infer<typeof PostMetricSnapshotSchema>;

/**
 * Social broadcast + metrics-read capability for AI tools and ingest jobs.
 *
 * Per AUTH_VIA_CAPABILITY_INTERFACE: auth is resolved by the implementation
 * (bearer token from config), not passed in context.
 */
export interface SocialXCapability {
  /**
   * Post one piece of content to one channel.
   *
   * @param input - Channel, adapted text, optional idempotency key
   * @returns The channel-native post id + posted timestamp
   * @throws If the post fails or the channel is unavailable
   */
  postContent(input: PostContentInput): Promise<PostContentResult>;

  /**
   * Read cached engagement metrics for a batch of external post ids.
   * Implementations should tolerate ids that no longer exist (skip them).
   *
   * @param externalIds - Channel-native post ids to read (caller batches ≤100)
   * @returns One snapshot per resolvable id
   * @throws If the metrics read fails or the channel is unavailable
   */
  readMetrics(externalIds: readonly string[]): Promise<PostMetricSnapshot[]>;
}
