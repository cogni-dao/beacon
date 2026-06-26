// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/internal/ops/growth/publish-approved`
 * Purpose: Internal operations endpoint that triggers the beacon growth-loop
 *   POST stage: publish one approved Moltbook post through the tenant's linked
 *   Moltbook connection and append the `post_decisions` propensity row.
 * Scope: Auth-protected POST endpoint for deploy/cron automation. Delegates to
 *   runPublishApprovedPostsJob(); does not implement publishing logic.
 * Invariants:
 *   - INTERNAL_OPS_AUTH: Requires Bearer INTERNAL_OPS_TOKEN (timing-safe compare)
 *   - APPROVED_ONLY: delegated job publishes only already-approved rows
 *   - BROKER_RESOLVES_ALL: delegated job gets Moltbook credentials via broker
 * Side-effects: IO (HTTP request/response, DB reads/writes, Moltbook HTTPS).
 * Links: docs/spec/beacon-growth-loop-v0.md §7
 * @internal
 */

import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { runPublishApprovedPostsJob } from "@/bootstrap/jobs/publishApprovedPosts.job";
import { serverEnv } from "@/shared/env";
import { EVENT_NAMES, logEvent } from "@/shared/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_AUTH_HEADER_LENGTH = 512;
const MAX_TOKEN_LENGTH = 256;

function safeCompare(a: string, b: string): boolean {
	const bufA = Buffer.from(a, "utf8");
	const bufB = Buffer.from(b, "utf8");
	if (bufA.length !== bufB.length) return false;
	return timingSafeEqual(bufA, bufB);
}

function extractBearerToken(authHeader: string | null): string | null {
	if (!authHeader) return null;
	if (authHeader.length > MAX_AUTH_HEADER_LENGTH) return null;

	const trimmed = authHeader.trim();
	if (!trimmed.toLowerCase().startsWith("bearer ")) return null;

	const token = trimmed.slice(7).trim();
	if (token.length > MAX_TOKEN_LENGTH) return null;

	return token;
}

export const POST = wrapRouteHandlerWithLogging(
	{ routeId: "growth.publish_approved.internal", auth: { mode: "none" } },
	async (ctx, request) => {
		const env = serverEnv();

		const configuredToken = env.INTERNAL_OPS_TOKEN;
		if (!configuredToken) {
			ctx.log.error("INTERNAL_OPS_TOKEN not configured");
			return NextResponse.json(
				{ error: "Service not configured" },
				{ status: 500 },
			);
		}

		const authHeader = request.headers.get("authorization");
		const providedToken = extractBearerToken(authHeader);
		if (!providedToken || !safeCompare(providedToken, configuredToken)) {
			ctx.log.warn("Invalid or missing INTERNAL_OPS_TOKEN");
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const start = performance.now();
		try {
			const summary = await runPublishApprovedPostsJob();
			const durationMs = Math.round(performance.now() - start);

			logEvent(ctx.log, EVENT_NAMES.GROWTH_PUBLISH_APPROVED_COMPLETE, {
				reqId: ctx.reqId,
				routeId: ctx.routeId,
				status: 200,
				durationMs,
				outcome: "success",
				considered: summary.considered,
				published: summary.published,
				skippedNoConnection: summary.skippedNoConnection,
				failed: summary.failed,
			});

			return NextResponse.json(summary, { status: 200 });
		} catch (error) {
			const durationMs = Math.round(performance.now() - start);

			logEvent(ctx.log, EVENT_NAMES.GROWTH_PUBLISH_APPROVED_COMPLETE, {
				reqId: ctx.reqId,
				routeId: ctx.routeId,
				status: 500,
				durationMs,
				outcome: "error",
				errorCode: "publish_failed",
			});

			throw error;
		}
	},
);
