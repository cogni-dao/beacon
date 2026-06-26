// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/jobs/publishApprovedPosts.job`
 * Purpose: POST-stage bridge for the beacon growth loop — publishes approved
 *   Moltbook posts through the tenant's linked Moltbook connection and records
 *   the append-only `post_decisions` propensity signal.
 * Scope: Service-role DB reads/writes + broker-resolved Moltbook adapter calls.
 *   Does NOT generate, refine, approve, reject, or ingest engagement metrics.
 * Invariants:
 *   - APPROVED_ONLY: only `posts.status = 'approved'` rows are eligible.
 *   - BROKER_RESOLVES_ALL: Moltbook API keys come from ConnectionBrokerPort.
 *   - CONNECTIONS_NOT_CHANNEL_ACCOUNTS: linked platform accounts live in
 *     `connections`; the legacy `channel_accounts` model is not used.
 *   - PROPENSITY_LOGGED: every successful publish appends a `post_decisions`
 *     row with action `posted`.
 *   - ONE_PER_RUN: v0 publishes at most one approved Moltbook post per tick,
 *     respecting Moltbook's tight posting cadence.
 * Side-effects: IO (DB reads/writes, HTTPS request to Moltbook).
 * Links: docs/spec/beacon-growth-loop-v0.md §2.6/§3/§7
 * @public
 */

import type { SocialXCapability } from "@cogni/ai-tools";
import { asc, and, eq, isNull, sql } from "drizzle-orm";

import { MoltbookSocialAdapter } from "@/adapters/server";
import { getServiceDb } from "@/adapters/server/db/drizzle.service-client";
import { getContainer } from "@/bootstrap/container";
import type { ConnectionBrokerPort } from "@/ports";
import {
	billingAccounts,
	postDecisions,
	posts,
} from "@/shared/db/schema";
import { serverEnv } from "@/shared/env";

const MAX_POSTS_PER_RUN = 1;
const PUBLISH_REASON = "approved_queue_highest_score";

export interface PublishApprovedPostsSummary {
	/** Approved Moltbook rows selected for this run. */
	considered: number;
	/** Rows successfully posted and moved to `posted`. */
	published: number;
	/** Approved rows left untouched because no tenant Moltbook connection exists. */
	skippedNoConnection: number;
	/** Rows moved to `failed` because posting threw. */
	failed: number;
}

interface ApprovedPostRow {
	id: string;
	accountId: string;
	campaignId: string;
	text: string;
	score: number | null;
	ownerUserId: string;
}

export interface PublishApprovedPostsDeps {
	db?: ReturnType<typeof getServiceDb>;
	broker?: ConnectionBrokerPort;
	makeMoltbookAdapter?: (accessToken: string) => SocialXCapability;
}

export async function runPublishApprovedPostsJob(
	deps: PublishApprovedPostsDeps = {},
): Promise<PublishApprovedPostsSummary> {
	const container = getContainer();
	const db = deps.db ?? getServiceDb();
	const broker = deps.broker ?? container.connectionBroker;
	if (!broker) {
		throw new Error("ConnectionBroker unavailable; cannot publish approved posts");
	}

	const env = serverEnv();
	const makeMoltbookAdapter =
		deps.makeMoltbookAdapter ??
		((accessToken: string) =>
			new MoltbookSocialAdapter({
				accessToken,
				...(env.MOLTBOOK_API_BASE_URL
					? { apiBaseUrl: env.MOLTBOOK_API_BASE_URL }
					: {}),
				timeoutMs: 10000,
			}));

	const rows = await db
		.select({
			id: posts.id,
			accountId: posts.accountId,
			campaignId: posts.campaignId,
			text: posts.text,
			score: posts.score,
			ownerUserId: billingAccounts.ownerUserId,
		})
		.from(posts)
		.innerJoin(billingAccounts, eq(posts.accountId, billingAccounts.id))
		.where(
			and(
				eq(posts.status, "approved"),
				eq(posts.channel, "moltbook"),
				isNull(posts.externalPostId),
			),
		)
		.orderBy(sql`${posts.score} DESC NULLS LAST`, asc(posts.createdAt))
		.limit(MAX_POSTS_PER_RUN);

	let published = 0;
	let skippedNoConnection = 0;
	let failed = 0;

	for (const [idx, row] of rows.entries()) {
		const result = await publishOne({
			db,
			broker,
			makeMoltbookAdapter,
			row,
			rank: idx + 1,
		});
		if (result === "published") published++;
		if (result === "skipped_no_connection") skippedNoConnection++;
		if (result === "failed") failed++;
	}

	const summary: PublishApprovedPostsSummary = {
		considered: rows.length,
		published,
		skippedNoConnection,
		failed,
	};
	container.log.info(summary, "growth.publish_approved complete");
	return summary;
}

async function publishOne(args: {
	db: ReturnType<typeof getServiceDb>;
	broker: ConnectionBrokerPort;
	makeMoltbookAdapter: (accessToken: string) => SocialXCapability;
	row: ApprovedPostRow;
	rank: number;
}): Promise<"published" | "skipped_no_connection" | "failed"> {
	const { db, broker, makeMoltbookAdapter, row, rank } = args;
	const resolved = await broker.resolveActive(row.accountId, "moltbook", {
		actorId: row.ownerUserId,
		tenantId: row.accountId,
	});
	if (!resolved) return "skipped_no_connection";

	try {
		const posted = await makeMoltbookAdapter(
			resolved.credentials.accessToken,
		).postContent({
			channel: "moltbook",
			text: row.text,
			idempotencyKey: row.id,
		});

		await db.transaction(async (tx) => {
			const [updated] = await tx
				.update(posts)
				.set({
					status: "posted",
					externalPostId: posted.externalId,
					postedAt: new Date(posted.postedAt),
				})
				.where(
					and(
						eq(posts.id, row.id),
						eq(posts.status, "approved"),
						isNull(posts.externalPostId),
					),
				)
				.returning({ id: posts.id });

			if (!updated) return;

			await tx.insert(postDecisions).values({
				accountId: row.accountId,
				campaignId: row.campaignId,
				postId: row.id,
				action: "posted",
				score: row.score,
				rank,
				reason: PUBLISH_REASON,
				modelRef: null,
			});
		});
		return "published";
	} catch {
		await db
			.update(posts)
			.set({ status: "failed" })
			.where(and(eq(posts.id, row.id), eq(posts.status, "approved")));
		return "failed";
	}
}
