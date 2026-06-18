// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/jobs/ingestPostMetrics.job`
 * Purpose: Metrics-ingest job for the beacon growth loop — reads recent posted
 *   `posts`, reads cached engagement via SocialXCapability, and APPENDS
 *   `post_metrics` snapshots. This is the SOLE `post_metrics` writer.
 * Scope: Wires the container's SocialXCapability + service-role DB. Does NOT post
 *   content or mutate `posts` (WORKER≠VERIFIER — the broadcast path is the worker).
 * Invariants:
 *   - SOLE_POST_METRICS_WRITER: this job is the only code that inserts `post_metrics`.
 *   - POST_METRICS_APPEND_ONLY: rows are inserted, never updated.
 *   - METRICS_BATCH_LE_100: external ids are batched ≤100 per readMetrics() call.
 *   - ACCOUNT_SCOPED: each appended `post_metrics` row inherits the parent post's
 *     `account_id` (the tenancy axis) so RLS scopes it.
 *   - SERVICE_ROLE_BYPASSES_RLS: this JOB reads/writes via the service-role DB (it
 *     operates across all accounts); RLS does not apply. It still writes account-scoped rows.
 * Side-effects: IO (DB reads/writes, social adapter reads via the container)
 * Links: docs/spec/beacon-growth-loop-v0.md §5
 * @public
 */

import { and, desc, eq, isNotNull } from "drizzle-orm";

import { getServiceDb } from "@/adapters/server/db/drizzle.service-client";
import { getContainer } from "@/bootstrap/container";
import { postMetrics, posts } from "@/shared/db/schema";

/** X v2 (and the capability boundary) tolerate at most 100 ids per readMetrics call. */
const METRICS_BATCH_SIZE = 100;

/** How many recent posted broadcasts to consider per ingest run. */
const MAX_BROADCASTS_PER_RUN = 500;

/**
 * Summary of one metrics-ingest run.
 */
export interface PostMetricsIngestSummary {
	/** Posted broadcasts considered (had an external post id). */
	considered: number;
	/** Metric snapshots appended to `post_metrics`. */
	appended: number;
	/** External ids returned no snapshot (deleted/unavailable post). */
	missing: number;
}

/** Chunk an array into fixed-size slices. */
function chunk<T>(items: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		out.push(items.slice(i, i + size));
	}
	return out;
}

/**
 * Run the post-metrics ingest job.
 *
 * 1. Read recent `posted` broadcasts that carry an `external_post_id`.
 * 2. Batch their external ids (≤100) and read cached engagement via the
 *    container's SocialXCapability.
 * 3. APPEND one `post_metrics` row per returned snapshot, mapping back to the
 *    owning broadcast by external id.
 *
 * SOLE_POST_METRICS_WRITER: no other code path inserts into `post_metrics`.
 */
export async function runIngestPostMetricsJob(): Promise<PostMetricsIngestSummary> {
	const container = getContainer();
	const { log, socialXCapability } = container;
	const db = getServiceDb();

	// 1) Recent posted posts with an external id (the only ones with metrics).
	const rows = await db
		.select({
			id: posts.id,
			accountId: posts.accountId,
			channel: posts.channel,
			externalPostId: posts.externalPostId,
		})
		.from(posts)
		.where(
			and(eq(posts.status, "posted"), isNotNull(posts.externalPostId)),
		)
		.orderBy(desc(posts.postedAt))
		.limit(MAX_BROADCASTS_PER_RUN);

	// Map external id → owning broadcast (id + account) for the snapshot stamp.
	// External ids are channel-native + unique.
	const broadcastByExternalId = new Map<
		string,
		{ id: string; accountId: string }
	>();
	for (const row of rows) {
		if (row.externalPostId) {
			broadcastByExternalId.set(row.externalPostId, {
				id: row.id,
				accountId: row.accountId,
			});
		}
	}

	const externalIds = [...broadcastByExternalId.keys()];
	if (externalIds.length === 0) {
		log.info({}, "metrics-ingest: no posted broadcasts to read");
		return { considered: 0, appended: 0, missing: 0 };
	}

	let appended = 0;
	let resolved = 0;

	// 2) Read in ≤100-id batches and 3) append snapshots.
	for (const batch of chunk(externalIds, METRICS_BATCH_SIZE)) {
		const snapshots = await socialXCapability.readMetrics(batch);
		resolved += snapshots.length;

		const values = snapshots
			.map((snap) => {
				const parent = broadcastByExternalId.get(snap.externalId);
				if (!parent) return null;
				return {
					accountId: parent.accountId,
					postId: parent.id,
					channel: snap.channel,
					capturedAt: new Date(snap.fetchedAt),
					impressions: snap.impressions ?? null,
					likes: snap.likes,
					reposts: snap.reposts,
					replies: snap.replies,
					followersAtCapture: snap.followers ?? null,
				};
			})
			.filter((v): v is NonNullable<typeof v> => v !== null);

		if (values.length > 0) {
			await db.insert(postMetrics).values(values);
			appended += values.length;
		}
	}

	const summary: PostMetricsIngestSummary = {
		considered: externalIds.length,
		appended,
		missing: externalIds.length - resolved,
	};

	log.info(summary, "metrics-ingest complete");
	return summary;
}
