// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/capabilities/broadcast`
 * Purpose: Factory for BroadcastCapability — posts staged per-channel variants via
 *   SocialXCapability and persists `broadcasts` rows for the beacon growth loop.
 * Scope: Wires the social adapter + Drizzle `broadcasts` writes. Does NOT compute KPIs.
 * Invariants:
 *   - NO_POST_METRICS_WRITE: this factory's only DB write surface is the `broadcasts`
 *     table. It never imports or writes `post_metrics` (WORKER≠VERIFIER — ingest is
 *     the sole `post_metrics` writer).
 *   - IDEA_KEY_GROUPS_VARIANTS: per-channel variants share `ideaKey`.
 *   - SERVICE_ROLE_NO_RLS: writes via the service-role DB (no RLS in growth v0).
 * Side-effects: none at construction (factory only). The returned capability does IO.
 * Links: docs/spec/beacon-growth-loop-v0.md §1/§3
 * @internal
 */

import type {
  BroadcastCapability,
  BroadcastInput,
  BroadcastResult,
  BroadcastVariantResult,
  SocialXCapability,
} from "@cogni/ai-tools";
import { eq } from "drizzle-orm";

import type { Database } from "@/adapters/server/db/client";
import { broadcasts } from "@/shared/db/schema";
import { makeLogger } from "@/shared/observability";

const logger = makeLogger({ component: "BroadcastCapability" });

/**
 * Dependencies for the broadcast capability.
 */
export interface BroadcastCapabilityDeps {
  /** Social adapter used to actually post each variant. */
  socialX: SocialXCapability;
  /** Service-role DB handle (no RLS in growth v0). */
  db: Database;
}

/**
 * Create a BroadcastCapability.
 *
 * For each variant: insert a `broadcasts` row (status `drafted`), post via the
 * social adapter, then update the row to `posted` with the external id (or
 * `failed` if the post throws). Per-channel variants share `idea_key`.
 *
 * NO_POST_METRICS_WRITE: this implementation touches only the `broadcasts`
 * table — never `post_metrics`.
 */
export function createBroadcastCapability(
  deps: BroadcastCapabilityDeps
): BroadcastCapability {
  return {
    broadcast: async (input: BroadcastInput): Promise<BroadcastResult> => {
      const results: BroadcastVariantResult[] = [];

      for (const variant of input.variants) {
        // 1) Stage the row first so a crash mid-post still leaves a record.
        const [row] = await deps.db
          .insert(broadcasts)
          .values({
            campaignId: input.campaignId,
            ideaKey: input.ideaKey,
            angle: input.angle ?? null,
            channel: variant.channel,
            text: variant.text,
            status: "drafted",
          })
          .returning({ id: broadcasts.id });

        if (!row) {
          throw new Error("Failed to persist broadcast row");
        }
        const broadcastId = row.id;

        // 2) Post via the social adapter.
        try {
          const posted = await deps.socialX.postContent({
            channel: variant.channel,
            text: variant.text,
            idempotencyKey: `${input.ideaKey}:${variant.channel}`,
          });

          // 3) Record external id + status posted.
          await deps.db
            .update(broadcasts)
            .set({
              status: "posted",
              externalPostId: posted.externalId,
              postedAt: new Date(posted.postedAt),
            })
            .where(eq(broadcasts.id, broadcastId));

          results.push({
            broadcastId,
            channel: variant.channel,
            status: "posted",
            externalPostId: posted.externalId,
          });
        } catch (error) {
          logger.error(
            { broadcastId, channel: variant.channel, reasonCode: "post_failed" },
            "broadcast post failed"
          );
          await deps.db
            .update(broadcasts)
            .set({ status: "failed" })
            .where(eq(broadcasts.id, broadcastId));

          results.push({
            broadcastId,
            channel: variant.channel,
            status: "failed",
            externalPostId: null,
          });
        }
      }

      return { ideaKey: input.ideaKey, results };
    },
  };
}
