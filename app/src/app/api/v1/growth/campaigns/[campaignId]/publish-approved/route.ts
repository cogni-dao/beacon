// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/growth/campaigns/[campaignId]/publish-approved`
 * Purpose: On-demand POST-stage trigger for one caller-owned campaign. Publishes at
 *   most one already-approved Moltbook post through the tenant's linked connection.
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
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer, resolveAppDb } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { runPublishApprovedPostsJob } from "@/bootstrap/jobs/publishApprovedPosts.job";
import { campaigns } from "@/shared/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = wrapRouteHandlerWithLogging<{
	params: Promise<{ campaignId: string }>;
}>(
	{
		routeId: "growth.campaigns.publish_approved",
		auth: { mode: "required", getSessionUser },
	},
	async (ctx, _request, sessionUser, context) => {
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
		const db = resolveAppDb();
		const actorId = userActor(sessionUser.id as UserId);

		const campaignRow = await withTenantScope(db, actorId, async (tx) => {
			const rows = await tx
				.select({
					campaignId: campaigns.campaignId,
					accountId: campaigns.accountId,
				})
				.from(campaigns)
				.where(eq(campaigns.campaignId, slug))
				.limit(1);
			return rows[0];
		});

		if (!campaignRow) {
			return NextResponse.json(
				{ error: "campaign not found" },
				{ status: 404 },
			);
		}

		const accountService = getContainer().accountsForUser(
			toUserId(sessionUser.id),
		);
		const account = await accountService.getOrCreateBillingAccountForUser({
			userId: sessionUser.id,
		});
		if (account.id !== campaignRow.accountId) {
			return NextResponse.json(
				{ error: "campaign not found" },
				{ status: 404 },
			);
		}

		const summary = await runPublishApprovedPostsJob({
			scope: { accountId: account.id, campaignId: slug },
		});

		ctx.log.info(
			{
				route: "growth.campaigns.publish_approved",
				campaignId: slug,
				considered: summary.considered,
				published: summary.published,
				skippedNoConnection: summary.skippedNoConnection,
				skippedNotEligible: summary.skippedNotEligible,
				failed: summary.failed,
			},
			"growth.campaign.publish_approved_complete",
		);

		return NextResponse.json({ campaignId: slug, ...summary }, { status: 200 });
	},
);
