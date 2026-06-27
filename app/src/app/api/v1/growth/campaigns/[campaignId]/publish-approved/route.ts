// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/growth/campaigns/[campaignId]/publish-approved`
 * Purpose: On-demand POST-stage trigger for one caller-owned campaign post. Publishes
 *   one explicit already-approved Moltbook post through the tenant's linked connection.
 * Scope: Session-authenticated HTTP boundary. Verifies campaign ownership with RLS,
 *   then delegates the broker-resolved publishing work to runPublishApprovedPostsJob.
 * Invariants:
 *   - AUTH_VIA_SESSION: session-cookie required; no deploy/internal bearer token.
 *   - RLS_SCOPED_CAMPAIGN: campaign ownership is checked under the session user's GUC.
 *   - APPROVED_ONLY: delegated job can only publish approved Moltbook queue rows.
 *   - TENANT_CONNECTION_ONLY: Moltbook credentials come from the user's connection row.
 * Side-effects: IO (HTTP, Postgres read/write, Moltbook HTTPS via job).
 * Links: docs/spec/beacon-growth-loop-v0.md §3/§4.
 * @public
 */

import { withTenantScope } from "@cogni/db-client";
import { toUserId, type UserId, userActor } from "@cogni/ids";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer, resolveAppDb } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { runPublishApprovedPostsJob } from "@/bootstrap/jobs/publishApprovedPosts.job";
import { campaigns, posts } from "@/shared/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PublishApprovedInputSchema = z.object({
	postId: z.string().uuid(),
});

export const POST = wrapRouteHandlerWithLogging<{
	params: Promise<{ campaignId: string }>;
}>(
	{
		routeId: "growth.campaigns.publish_approved",
		auth: { mode: "required", getSessionUser },
	},
	async (ctx, request, sessionUser, context) => {
		if (!sessionUser) {
			return NextResponse.json({ error: "unauthorized" }, { status: 401 });
		}
		if (!context) {
			return NextResponse.json(
				{ error: "missing route context" },
				{ status: 400 },
			);
		}

		const { campaignId } = await context.params;
		const slug = decodeURIComponent(campaignId);
		let body: unknown;
		try {
			body = await request.json();
		} catch {
			return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
		}
		const parsed = PublishApprovedInputSchema.safeParse(body);
		if (!parsed.success) {
			return NextResponse.json(
				{ error: "invalid input", issues: parsed.error.issues },
				{ status: 400 },
			);
		}
		const { postId } = parsed.data;
		const db = resolveAppDb();
		const actorId = userActor(sessionUser.id as UserId);

		const loaded = await withTenantScope(db, actorId, async (tx) => {
			const campaignRows = await tx
				.select({
					campaignId: campaigns.campaignId,
					accountId: campaigns.accountId,
				})
				.from(campaigns)
				.where(eq(campaigns.campaignId, slug))
				.limit(1);
			const postRows = await tx
				.select({
					id: posts.id,
					status: posts.status,
					channel: posts.channel,
					externalPostId: posts.externalPostId,
				})
				.from(posts)
				.where(and(eq(posts.id, postId), eq(posts.campaignId, slug)))
				.limit(1);
			return { campaignRow: campaignRows[0], postRow: postRows[0] };
		});

		if (!loaded.campaignRow || !loaded.postRow) {
			return NextResponse.json(
				{ error: "post not found" },
				{ status: 404 },
			);
		}
		if (loaded.postRow.status !== "approved") {
			return NextResponse.json(
				{ error: "post must be approved before publish" },
				{ status: 409 },
			);
		}
		if (loaded.postRow.channel !== "moltbook") {
			return NextResponse.json(
				{ error: "only Moltbook posts can be published here" },
				{ status: 409 },
			);
		}
		if (loaded.postRow.externalPostId) {
			return NextResponse.json(
				{ error: "post is already published" },
				{ status: 409 },
			);
		}

		const accountService = getContainer().accountsForUser(
			toUserId(sessionUser.id),
		);
		const account = await accountService.getOrCreateBillingAccountForUser({
			userId: sessionUser.id,
		});
		if (account.id !== loaded.campaignRow.accountId) {
			return NextResponse.json(
				{ error: "post not found" },
				{ status: 404 },
			);
		}

		const summary = await runPublishApprovedPostsJob({
			scope: { accountId: account.id, campaignId: slug, postId },
		});

		ctx.log.info(
			{
				route: "growth.campaigns.publish_approved",
				campaignId: slug,
				postId,
				considered: summary.considered,
				published: summary.published,
				skippedNoConnection: summary.skippedNoConnection,
				skippedNotEligible: summary.skippedNotEligible,
				skippedMissingPayload: summary.skippedMissingPayload,
				failed: summary.failed,
			},
			"growth.campaign.publish_approved_complete",
		);

		return NextResponse.json({ campaignId: slug, postId, ...summary }, { status: 200 });
	},
);
