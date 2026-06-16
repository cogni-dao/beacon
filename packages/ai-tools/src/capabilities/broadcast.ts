// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/capabilities/broadcast`
 * Purpose: Broadcast capability — post staged per-channel variants and persist
 *   `broadcasts` rows for the beacon growth loop.
 * Scope: Interface + Zod boundary schemas. Does NOT implement DB/transport.
 * Invariants:
 *   - NO_POST_METRICS_WRITE: the broadcast write surface persists `broadcasts`
 *     ONLY. It never writes `post_metrics` (WORKER≠VERIFIER — ingest is sole writer).
 *   - IDEA_KEY_GROUPS_VARIANTS: per-channel variants of one core idea share `ideaKey`.
 *   - STRUCTURED_RESULTS: Zod-validated input/output.
 * Side-effects: none (interface + schemas only)
 * Links: docs/spec/beacon-growth-loop-v0.md §1/§3
 * @public
 */

import { z } from "zod";

import { SOCIAL_CHANNELS } from "./social-x";

/**
 * One per-channel variant to broadcast. `channel` selects the backend;
 * `text` is already platform-adapted by the content graph.
 */
export const BroadcastVariantSchema = z.object({
  channel: z.enum(SOCIAL_CHANNELS).describe("Target channel for this variant"),
  text: z.string().min(1).describe("Platform-adapted post body"),
});
export type BroadcastVariant = z.infer<typeof BroadcastVariantSchema>;

/**
 * Input for broadcasting one core idea's variants across channels.
 * All variants share `campaignId`, `ideaKey`, and `angle` — they are the same
 * idea expressed per platform.
 */
export const BroadcastInputSchema = z.object({
  campaignId: z.string().min(1).describe("Owning campaign hypothesis id"),
  ideaKey: z
    .string()
    .min(1)
    .max(200)
    .describe("Stable key grouping per-channel variants of one core idea"),
  angle: z
    .string()
    .max(500)
    .optional()
    .describe("The angle/hook this idea expresses"),
  variants: z
    .array(BroadcastVariantSchema)
    .min(1)
    .describe("One staged variant per enabled channel"),
});
export type BroadcastInput = z.infer<typeof BroadcastInputSchema>;

/**
 * Result of broadcasting one variant.
 */
export const BroadcastVariantResultSchema = z.object({
  broadcastId: z.string().min(1).describe("Persisted `broadcasts.id`"),
  channel: z.enum(SOCIAL_CHANNELS),
  status: z
    .enum(["posted", "failed"])
    .describe("Post lifecycle status after broadcast"),
  externalPostId: z
    .string()
    .nullable()
    .describe("Channel-native post id (null when failed)"),
});
export type BroadcastVariantResult = z.infer<
  typeof BroadcastVariantResultSchema
>;

/**
 * Result of a broadcast call — one entry per input variant.
 */
export const BroadcastResultSchema = z.object({
  ideaKey: z.string(),
  results: z.array(BroadcastVariantResultSchema),
});
export type BroadcastResult = z.infer<typeof BroadcastResultSchema>;

/**
 * Broadcast capability: post staged variants + persist `broadcasts` rows.
 *
 * NO_POST_METRICS_WRITE: implementations of this capability persist only the
 * `broadcasts` table. Cached engagement (`post_metrics`) is written exclusively
 * by the metrics-ingest path.
 */
export interface BroadcastCapability {
  /**
   * Broadcast one core idea's per-channel variants.
   * For each variant: persist a `broadcasts` row, post via the social adapter,
   * then record `external_post_id` + status `posted` (or `failed`).
   *
   * @param input - Campaign/idea/variants to broadcast
   * @returns Per-variant broadcast results
   */
  broadcast(input: BroadcastInput): Promise<BroadcastResult>;
}
