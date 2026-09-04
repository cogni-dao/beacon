// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/cognition/research`
 * Purpose: GET /api/v1/cognition/research — focused cognition briefing for
 *   research agents. Reuses the session cognition substrate shape while
 *   emphasizing recall-first research, activity prioritization, and tenant-data
 *   boundaries.
 * Scope: Single authed GET (cookie-session human or bearer agent). Reads the
 *   knowledge hub index only; no tenant campaign context in v0.
 * Invariants:
 *   - RESEARCH_BRIEFING_NOT_REGISTRY: points agents at existing surfaces; it is
 *     not a bespoke capability registry.
 *   - NO_TENANT_CONTEXT_V0: no campaign/user operational data is included.
 *   - SAME_CONTRACT_SHAPE: response validates as CognitionBundleResponseSchema.
 * Side-effects: IO (HTTP response, Doltgres reads via container port)
 * Links: ../route.ts, ../_bundle.ts, docs/spec/knowledge-syntropy.md
 * @public
 */

import {
	CognitionBundleResponseSchema,
	type CognitionDomainPointer,
	type CognitionSkillPointer,
} from "@cogni/node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { getNodeMission, getNodeName } from "@/shared/config";
import { serverEnv } from "@/shared/env";
import {
	excerptFromContent,
	isCognitionEntry,
	type OrientationExcerpt,
	renderResearchBundleMarkdown,
	SESSION_BOOTSTRAP_INVARIANTS,
} from "../_bundle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PER_DOMAIN_LIMIT = 50;
const CACHE_CONTROL = "private, max-age=60, stale-while-revalidate=300";

function publicOrigin(request: Request): string {
	const url = new URL(request.url);
	const host =
		request.headers.get("x-forwarded-host") ??
		request.headers.get("host") ??
		url.host;
	const proto =
		request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
	return `${proto}://${host}`;
}

export const GET = wrapRouteHandlerWithLogging(
	{
		routeId: "cognition.research",
		auth: { mode: "required", getSessionUser },
	},
	async (ctx, request, sessionUser) => {
		if (!sessionUser) {
			return NextResponse.json({ error: "unauthorized" }, { status: 401 });
		}

		const container = getContainer();
		const origin = publicOrigin(request);
		const node = container.nodeId;
		const name = getNodeName();
		const mission = getNodeMission();
		const buildSha = serverEnv().APP_BUILD_SHA ?? "unknown";
		const generatedAt = new Date().toISOString();
		const skillsIndex: CognitionSkillPointer[] = [];
		const domainPointers: CognitionDomainPointer[] = [];
		const exactOrientationId = `${name}-agent-orientation`;
		let orientationId: string | null = null;

		const port = container.knowledgeStorePort;
		if (port) {
			const domains = await port.listDomainsFull();
			for (const d of domains) {
				if (d.entryCount === 0) continue;
				domainPointers.push({
					domain: d.id,
					description: d.description,
					entryCount: d.entryCount,
				});
				const rows = await port.listKnowledge(d.id, {
					limit: PER_DOMAIN_LIMIT,
				});
				for (const r of rows) {
					if (r.id === exactOrientationId) {
						orientationId = r.id;
					} else if (!orientationId && r.id.endsWith("-agent-orientation")) {
						orientationId = r.id;
					}
					if (!isCognitionEntry(r.entryType)) continue;
					skillsIndex.push({
						id: r.id,
						title: r.title,
						entryType: r.entryType ?? "guide",
						domain: r.domain,
					});
				}
			}
		}

		let orientation: OrientationExcerpt | null = null;
		if (port && orientationId) {
			const entry = await port.getKnowledge(orientationId);
			if (entry) {
				orientation = {
					id: entry.id,
					excerpt: excerptFromContent(entry.content),
				};
			}
		}

		const toolingInvariants = [...SESSION_BOOTSTRAP_INVARIANTS];
		const researchPointers = [
			"Recall `strat-measure-learn` before prioritizing growth activity.",
			"Recall `audience-source-intel` before proposing where to research audiences.",
			"Recall `synthesize-not-reports` before shaping user-facing output.",
			"Recall `social-automation-compliance-baseline` before recommending publishing or social automation.",
			"Recall `raw-to-wiki-curation` before proposing reusable knowledge writeback.",
		];
		const agentSurfacePointers = [
			`Discover available agents: GET ${origin}/api/v1/ai/agents`,
			`Recall knowledge: GET ${origin}/api/v1/knowledge?domain=<domain>`,
			`Inspect work items: GET ${origin}/api/v1/work/items`,
			`List campaigns: GET ${origin}/api/v1/growth/campaigns`,
			`Run campaign research: POST ${origin}/api/v1/growth/campaigns/{campaignId}/research`,
			`Execute existing graph runs through the agent/run APIs when authorized.`,
		];
		const recallProtocol =
			`RECALL first via GET ${origin}/api/v1/knowledge?domain=<domain>. ` +
			"Use tenant-specific campaign evidence only through RLS-scoped growth APIs; never write tenant facts to Dolt.";

		const markdown = renderResearchBundleMarkdown({
			node,
			name,
			mission,
			generatedAt,
			origin,
			buildSha,
			toolingInvariants,
			skillsIndex,
			domainPointers,
			orientation,
			researchPointers,
			agentSurfacePointers,
		});

		ctx.log.info(
			{
				node,
				name,
				skills: skillsIndex.length,
				domains: domainPointers.length,
				orientation: orientation?.id ?? null,
				hub: Boolean(port),
			},
			"cognition.research_success",
		);

		const response = NextResponse.json(
			CognitionBundleResponseSchema.parse({
				node,
				name,
				mission,
				version: "v1",
				buildSha,
				generatedAt,
				toolingInvariants,
				skillsIndex,
				domainPointers,
				recallProtocol,
				markdown,
			}),
		);
		response.headers.set("Cache-Control", CACHE_CONTROL);
		return response;
	},
);
