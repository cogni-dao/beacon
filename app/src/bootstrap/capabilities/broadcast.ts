// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/capabilities/broadcast`
 * Purpose: Factory for BroadcastCapability — posts staged per-channel variants via
 *   SocialXCapability and persists `posts` rows for the beacon growth loop.
 * Scope: Wires the social adapter + Drizzle `posts` writes. Does NOT compute KPIs.
 * Invariants:
 *   - NO_POST_METRICS_WRITE: this factory's only DB write surface is the `posts`
 *     table. It never imports or writes `post_metrics` (WORKER≠VERIFIER — ingest is
 *     the sole `post_metrics` writer).
 *   - IDEA_KEY_GROUPS_VARIANTS: per-channel variants share `ideaKey`.
 *   - FUNNEL_CLASSIFIED: each row persists its `funnel_layer` + `topic`; `kind='text'`,
 *     `bundle_id=null`, `seq=0` in v0 (thread/artifact/bundle columns reserved).
 *   - ACCOUNT_SCOPED: each `posts` row is stamped with the caller's `accountId`
 *     (billing account, the tenancy axis) so RLS scopes it. The worker writes via the
 *     service-role DB (bypasses RLS) but persists account-scoped rows from row one.
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
import { posts } from "@/shared/db/schema";
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
 * For each variant: insert a `posts` row (status `generated`), post via the
 * social adapter, then update the row to `posted` with the external id (or
 * `failed` if the post throws). Per-channel variants share `idea_key`.
 *
 * NO_POST_METRICS_WRITE: this implementation touches only the `posts`
 * table — never `post_metrics`.
 */
export function createBroadcastCapability(
	deps: BroadcastCapabilityDeps,
): BroadcastCapability {
	return {
		broadcast: async (input: BroadcastInput): Promise<BroadcastResult> => {
			const results: BroadcastVariantResult[] = [];

			for (const variant of input.variants) {
				// 1) Stage the row first so a crash mid-post still leaves a record.
				const [row] = await deps.db
					.insert(posts)
					.values({
						accountId: input.accountId,
						campaignId: input.campaignId,
						ideaKey: input.ideaKey,
						angle: input.angle ?? null,
						channel: variant.channel,
						funnelLayer: variant.funnelLayer,
						topic: variant.topic ?? null,
						kind: variant.kind,
						// bundle_id / seq reserved for tweet-chains; single text posts in v0.
						bundleId: null,
						seq: 0,
						text: variant.text,
						status: "generated",
					})
					.returning({ id: posts.id });

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
						.update(posts)
						.set({
							status: "posted",
							externalPostId: posted.externalId,
							postedAt: new Date(posted.postedAt),
						})
						.where(eq(posts.id, broadcastId));

					results.push({
						broadcastId,
						channel: variant.channel,
						status: "posted",
						externalPostId: posted.externalId,
					});
				} catch (_error) {
					logger.error(
						{
							broadcastId,
							channel: variant.channel,
							reasonCode: "post_failed",
						},
						"broadcast post failed",
					);
					await deps.db
						.update(posts)
						.set({ status: "failed" })
						.where(eq(posts.id, broadcastId));

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
