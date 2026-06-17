// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/tools/broadcast-post`
 * Purpose: AI tool that broadcasts a core idea's per-channel variants — posts via
 *   the social adapter and persists `broadcasts` rows for the beacon growth loop.
 * Scope: Thin tool over BroadcastCapability. Does NOT implement DB/transport.
 * Invariants:
 *   - TOOL_ID_NAMESPACED: ID is `core__broadcast_post`
 *   - EFFECT_TYPED: effect is `state_change` (posts + DB writes via capability)
 *   - NO_POST_METRICS_WRITE: this tool's only write surface is BroadcastCapability,
 *     which persists `broadcasts` ONLY — never `post_metrics`. Cached engagement is
 *     written exclusively by the metrics-ingest path (WORKER≠VERIFIER).
 *   - IDEA_KEY_GROUPS_VARIANTS: per-channel variants share `ideaKey`.
 *   - NO LangChain imports (LangChain wrapping happens in langgraph-graphs).
 * Side-effects: IO (post to social channels + persist `broadcasts` via capability)
 * Links: docs/spec/beacon-growth-loop-v0.md §1/§3
 * @public
 */

import { z } from "zod";

import {
  BROADCAST_KINDS,
  type BroadcastCapability,
  FUNNEL_LAYERS,
} from "../capabilities/broadcast";
import { SOCIAL_CHANNELS } from "../capabilities/social-x";
import type { BoundTool, ToolContract, ToolImplementation } from "../types";

// ─── Schemas ─────────────────────────────────────────────────────────────────

export const BroadcastPostInputSchema = z.object({
  campaignId: z
    .string()
    .min(1)
    .describe("Owning campaign hypothesis id"),
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
    .array(
      z.object({
        channel: z.enum(SOCIAL_CHANNELS).describe("Target channel"),
        text: z.string().min(1).describe("Platform-adapted post body"),
        funnelLayer: z
          .enum(FUNNEL_LAYERS)
          .describe("Funnel position: tofu (awareness) → mofu → bofu (action)"),
        topic: z
          .string()
          .max(120)
          .nullable()
          .describe("Subject this variant angles at (e.g. 'ownership')"),
        kind: z
          .enum(BROADCAST_KINDS)
          .describe("Content kind — text-only in v0; others reserved"),
      })
    )
    .min(1)
    .describe("One staged variant per (funnel layer × enabled channel)"),
});
export type BroadcastPostInput = z.infer<typeof BroadcastPostInputSchema>;

export const BroadcastPostOutputSchema = z.object({
  ideaKey: z.string(),
  results: z.array(
    z.object({
      broadcastId: z.string(),
      channel: z.enum(SOCIAL_CHANNELS),
      status: z.enum(["posted", "failed"]),
      externalPostId: z.string().nullable(),
    })
  ),
});
export type BroadcastPostOutput = z.infer<typeof BroadcastPostOutputSchema>;
export type BroadcastPostRedacted = BroadcastPostOutput;

// ─── Contract ────────────────────────────────────────────────────────────────

export const BROADCAST_POST_NAME = "core__broadcast_post" as const;

export const broadcastPostContract: ToolContract<
  typeof BROADCAST_POST_NAME,
  BroadcastPostInput,
  BroadcastPostOutput,
  BroadcastPostRedacted
> = {
  name: BROADCAST_POST_NAME,
  description:
    "Broadcast a core idea's per-channel variants to the configured social channels. " +
    "Persists one `broadcasts` row per variant (variants share an ideaKey), posts each " +
    "via the social adapter, and records the external post id with status 'posted'. " +
    "Does NOT read or write engagement metrics — that is the ingest path's job.",
  effect: "state_change",
  inputSchema: BroadcastPostInputSchema,
  outputSchema: BroadcastPostOutputSchema,
  redact: (output) => output,
  allowlist: ["ideaKey", "results"] as const,
};

// ─── Implementation ──────────────────────────────────────────────────────────

export interface BroadcastPostDeps {
  broadcastCapability: BroadcastCapability;
}

export function createBroadcastPostImplementation(
  deps: BroadcastPostDeps
): ToolImplementation<BroadcastPostInput, BroadcastPostOutput> {
  return {
    execute: async (input) => {
      const result = await deps.broadcastCapability.broadcast({
        campaignId: input.campaignId,
        ideaKey: input.ideaKey,
        angle: input.angle,
        variants: input.variants,
      });
      return {
        ideaKey: result.ideaKey,
        results: result.results.map((r) => ({
          broadcastId: r.broadcastId,
          channel: r.channel,
          status: r.status,
          externalPostId: r.externalPostId,
        })),
      };
    },
  };
}

export const broadcastPostStubImplementation: ToolImplementation<
  BroadcastPostInput,
  BroadcastPostOutput
> = {
  execute: async () => {
    throw new Error(
      "BroadcastCapability not configured. Social broadcast not available."
    );
  },
};

// ─── Bound Tool ──────────────────────────────────────────────────────────────

export const broadcastPostBoundTool: BoundTool<
  typeof BROADCAST_POST_NAME,
  BroadcastPostInput,
  BroadcastPostOutput,
  BroadcastPostRedacted
> = {
  contract: broadcastPostContract,
  implementation: broadcastPostStubImplementation,
};
