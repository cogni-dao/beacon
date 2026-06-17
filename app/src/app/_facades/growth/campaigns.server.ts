// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/_facades/growth/campaigns.server`
 * Purpose: Server-side facade for the read-only `/growth` lens — lists campaign
 *   hypotheses (domain `beacon-campaigns`) with their CURRENT engagement KPI
 *   computed independently from cached `post_metrics`.
 * Scope: Composes the `KnowledgeStorePort` (Doltgres) + RLS-scoped Postgres
 *   read + the pure `computeEngagementKpi`. No business logic beyond mapping;
 *   the KPI math lives in `@cogni/knowledge-store`.
 * Invariants:
 *   - PORT_VIA_CONTAINER: store/resolver pulled from the container.
 *   - KPI_NEVER_SELF_CITED: the surfaced KPI derives solely from `post_metrics`,
 *     never from the hypothesis confidence — the same pure fn the resolver uses.
 *   - READ_ONLY: no writes; the lens only observes the loop.
 *   - RLS_SCOPED_READS: the user-facing Postgres reads (broadcasts/post_metrics)
 *     run inside `withTenantScope` under the session user's GUC — RLS filters rows
 *     to the user's billing account(s). NEVER the service-role DB (that leaks every
 *     account's rows). The campaign LIST still comes from shared Doltgres (the
 *     documented campaigns→Postgres vNext gap).
 * Side-effects: IO (Doltgres + Postgres reads via ports)
 * Links: docs/spec/beacon-growth-loop-v0.md §6, app/src/app/(app)/growth/view.tsx
 * @internal
 */

import { withTenantScope } from "@cogni/db-client";
import { type UserId, userActor } from "@cogni/ids";
import {
	computeEngagementKpi,
	type EngagementBasis,
	type PostMetricSnapshot,
} from "@cogni/knowledge-store";
import { and, eq, inArray } from "drizzle-orm";

import { getContainer, resolveAppDb } from "@/bootstrap/container";
import { broadcasts, postMetrics } from "@/shared/db/schema";

const DOMAIN_CAMPAIGNS = "beacon-campaigns";
const METRIC_ENGAGEMENT_PREFIX = "metric:engagement:";
const DEFAULT_TARGET_RATE = 0.02;

/** Funnel layers in funnel order (awareness → consideration → action). */
export const FUNNEL_LAYERS = ["tofu", "mofu", "bofu"] as const;
export type FunnelLayer = (typeof FUNNEL_LAYERS)[number];

/** Independent engagement KPI for one funnel layer (a slice of a campaign). */
export interface FunnelLayerKpi {
	score0to100: number;
	edge: "validates" | "invalidates";
	observedRate: number;
	basis: EngagementBasis;
	/** Posted broadcasts classified to this layer. */
	postedBroadcasts: number;
	/** Cached metric snapshots scored for this layer. */
	snapshotCount: number;
}

/** Per-layer KPI breakdown, keyed by funnel layer (never one blended number). */
export type FunnelLayerBreakdown = Record<FunnelLayer, FunnelLayerKpi>;

/** One campaign row for the lens. */
export interface CampaignLensRow {
	campaignId: string;
	hypothesisId: string;
	title: string;
	targetRate: number | null;
	evaluateAt: string | null;
	confidencePct: number | null;
	resolved: boolean;
	score0to100: number;
	edge: "validates" | "invalidates";
	observedRate: number;
	basis: EngagementBasis;
	snapshotCount: number;
	postedBroadcasts: number;
	/** Independent KPI computed PER funnel layer (tofu/mofu/bofu). */
	layers: FunnelLayerBreakdown;
}

function targetRateFromContent(content: string): number | null {
	const m = content.match(/target[_\s-]?rate["\s:=]+([0-9]*\.?[0-9]+)/i);
	if (m?.[1]) {
		const rate = Number(m[1]);
		if (Number.isFinite(rate) && rate > 0 && rate <= 1) return rate;
	}
	return null;
}

function campaignIdFromStrategy(
	strategy: string | null | undefined,
): string | null {
	if (!strategy || !strategy.startsWith(METRIC_ENGAGEMENT_PREFIX)) return null;
	const id = strategy.slice(METRIC_ENGAGEMENT_PREFIX.length).trim();
	return id.length > 0 ? id : null;
}

/** Normalize a raw `funnel_layer` value to a known layer (defaults to tofu). */
function asFunnelLayer(raw: string | null | undefined): FunnelLayer {
	return (FUNNEL_LAYERS as readonly string[]).includes(raw ?? "")
		? (raw as FunnelLayer)
		: "tofu";
}

interface CampaignSnapshots {
	/** All snapshots across the campaign (the overall/blended KPI input). */
	snapshots: PostMetricSnapshot[];
	/** Total posted broadcasts across the campaign. */
	postedBroadcasts: number;
	/** Snapshots grouped by the funnel layer of their owning broadcast. */
	byLayer: Record<FunnelLayer, PostMetricSnapshot[]>;
	/** Posted-broadcast counts grouped by funnel layer. */
	postedByLayer: Record<FunnelLayer, number>;
}

function emptyLayerMap<T>(make: () => T): Record<FunnelLayer, T> {
	return { tofu: make(), mofu: make(), bofu: make() };
}

async function loadCampaignSnapshots(
	campaignId: string,
	userId: string,
): Promise<CampaignSnapshots> {
	const db = resolveAppDb();
	const actorId = userActor(userId as UserId);

	const byLayer = emptyLayerMap<PostMetricSnapshot[]>(() => []);
	const postedByLayer = emptyLayerMap<number>(() => 0);

	// RLS_SCOPED_READS: filter to the session user's account(s) via the GUC.
	return withTenantScope(db, actorId, async (tx) => {
		const broadcastRows = await tx
			.select({ id: broadcasts.id, funnelLayer: broadcasts.funnelLayer })
			.from(broadcasts)
			.where(
				and(
					eq(broadcasts.campaignId, campaignId),
					eq(broadcasts.status, "posted"),
				),
			);

		if (broadcastRows.length === 0) {
			return { snapshots: [], postedBroadcasts: 0, byLayer, postedByLayer };
		}

		const layerOf = new Map<string, FunnelLayer>();
		for (const r of broadcastRows) {
			const layer = asFunnelLayer(r.funnelLayer);
			layerOf.set(r.id, layer);
			postedByLayer[layer] += 1;
		}
		const broadcastIds = broadcastRows.map((r) => r.id);

		const rows = await tx
			.select({
				broadcastId: postMetrics.broadcastId,
				impressions: postMetrics.impressions,
				likes: postMetrics.likes,
				reposts: postMetrics.reposts,
				replies: postMetrics.replies,
				followersAtCapture: postMetrics.followersAtCapture,
			})
			.from(postMetrics)
			.where(inArray(postMetrics.broadcastId, broadcastIds));

		const snapshots: PostMetricSnapshot[] = [];
		for (const r of rows) {
			const snapshot: PostMetricSnapshot = {
				impressions: r.impressions ?? null,
				likes: r.likes ?? 0,
				reposts: r.reposts ?? 0,
				replies: r.replies ?? 0,
				followersAtCapture: r.followersAtCapture ?? null,
			};
			snapshots.push(snapshot);
			const layer = layerOf.get(r.broadcastId) ?? "tofu";
			byLayer[layer].push(snapshot);
		}

		return {
			snapshots,
			postedBroadcasts: broadcastIds.length,
			byLayer,
			postedByLayer,
		};
	});
}

/** Compute the per-layer KPI breakdown from grouped snapshots + posted counts. */
function computeLayerBreakdown(
	loaded: CampaignSnapshots,
	targetRate: number,
): FunnelLayerBreakdown {
	const out = {} as FunnelLayerBreakdown;
	for (const layer of FUNNEL_LAYERS) {
		const layerSnapshots = loaded.byLayer[layer];
		const kpi = computeEngagementKpi(layerSnapshots, { rate: targetRate });
		out[layer] = {
			score0to100: kpi.score0to100,
			edge: kpi.edge,
			observedRate: kpi.observedRate,
			basis: kpi.basis,
			postedBroadcasts: loaded.postedByLayer[layer],
			snapshotCount: layerSnapshots.length,
		};
	}
	return out;
}

/**
 * List every campaign hypothesis in `beacon-campaigns` with its current,
 * independently-computed engagement KPI. Returns `[]` when the knowledge store
 * is unconfigured (DOLTGRES_URL unset) so the lens degrades gracefully.
 *
 * @param userId - Session user id; the Postgres reads run under this user's RLS
 *   scope so the KPI reflects only the user's own account(s).
 */
export async function listGrowthCampaigns(
	userId: string,
): Promise<CampaignLensRow[]> {
	const container = getContainer();
	const store = container.knowledgeStorePort;
	if (!store) return [];

	const rows = await store.listKnowledge(DOMAIN_CAMPAIGNS, { limit: 200 });
	const hypotheses = rows.filter((r) => r.entryType === "hypothesis");

	const out: CampaignLensRow[] = [];
	for (const h of hypotheses) {
		const campaignId =
			campaignIdFromStrategy(h.resolutionStrategy) ??
			(h.id.startsWith("campaign:") ? h.id.slice("campaign:".length) : null);
		if (!campaignId) continue;

		const loaded = await loadCampaignSnapshots(campaignId, userId);
		const targetRate = targetRateFromContent(h.content);
		const effectiveTarget = targetRate ?? DEFAULT_TARGET_RATE;
		const kpi = computeEngagementKpi(loaded.snapshots, {
			rate: effectiveTarget,
		});
		const layers = computeLayerBreakdown(loaded, effectiveTarget);

		const incoming = await store.listCitationsByCitedId(h.id);
		const resolved = incoming.some(
			(c) => c.citationType === "validates" || c.citationType === "invalidates",
		);

		out.push({
			campaignId,
			hypothesisId: h.id,
			title: h.title,
			targetRate,
			evaluateAt: h.evaluateAt ? h.evaluateAt.toISOString() : null,
			confidencePct: h.confidencePct ?? null,
			resolved,
			score0to100: kpi.score0to100,
			edge: kpi.edge,
			observedRate: kpi.observedRate,
			basis: kpi.basis,
			snapshotCount: loaded.snapshots.length,
			postedBroadcasts: loaded.postedBroadcasts,
			layers,
		});
	}

	// Stable order: unresolved (active) first, then by title.
	out.sort((a, b) => {
		if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
		return a.title.localeCompare(b.title);
	});
	return out;
}

/** One broadcast (post) under a campaign, with its latest cached metrics. */
export interface CampaignPost {
	id: string;
	channel: string;
	funnelLayer: FunnelLayer;
	topic: string | null;
	angle: string | null;
	text: string;
	status: string;
	externalPostId: string | null;
	postedAt: string | null;
	impressions: number | null;
	likes: number;
	reposts: number;
	replies: number;
	capturedAt: string | null;
}

/** Full detail for one campaign — the lens row plus its brief and posts. */
export interface CampaignDetail extends CampaignLensRow {
	/** The campaign brief / goal (hypothesis content). */
	brief: string;
	posts: CampaignPost[];
}

async function loadCampaignPosts(
	campaignId: string,
	userId: string,
): Promise<CampaignPost[]> {
	const db = resolveAppDb();
	const actorId = userActor(userId as UserId);

	// RLS_SCOPED_READS: filter to the session user's account(s) via the GUC.
	const { rows, latest } = await withTenantScope(db, actorId, async (tx) => {
		const broadcastRows = await tx
			.select({
				id: broadcasts.id,
				channel: broadcasts.channel,
				funnelLayer: broadcasts.funnelLayer,
				topic: broadcasts.topic,
				angle: broadcasts.angle,
				text: broadcasts.text,
				status: broadcasts.status,
				externalPostId: broadcasts.externalPostId,
				postedAt: broadcasts.postedAt,
			})
			.from(broadcasts)
			.where(eq(broadcasts.campaignId, campaignId));
		if (broadcastRows.length === 0) {
			return { rows: broadcastRows, latest: new Map<string, never>() };
		}

		const ids = broadcastRows.map((r) => r.id);
		const metricRows = await tx
			.select({
				broadcastId: postMetrics.broadcastId,
				capturedAt: postMetrics.capturedAt,
				impressions: postMetrics.impressions,
				likes: postMetrics.likes,
				reposts: postMetrics.reposts,
				replies: postMetrics.replies,
			})
			.from(postMetrics)
			.where(inArray(postMetrics.broadcastId, ids));

		// Keep only the latest snapshot per broadcast.
		const latestByBroadcast = new Map<string, (typeof metricRows)[number]>();
		for (const m of metricRows) {
			const cur = latestByBroadcast.get(m.broadcastId);
			if (
				!cur ||
				(m.capturedAt?.getTime() ?? 0) > (cur.capturedAt?.getTime() ?? 0)
			) {
				latestByBroadcast.set(m.broadcastId, m);
			}
		}
		return { rows: broadcastRows, latest: latestByBroadcast };
	});

	if (rows.length === 0) return [];

	return rows.map((r) => {
		const m = latest.get(r.id);
		return {
			id: r.id,
			channel: r.channel,
			funnelLayer: asFunnelLayer(r.funnelLayer),
			topic: r.topic ?? null,
			angle: r.angle ?? null,
			text: r.text,
			status: r.status,
			externalPostId: r.externalPostId ?? null,
			postedAt: r.postedAt ? r.postedAt.toISOString() : null,
			impressions: m?.impressions ?? null,
			likes: m?.likes ?? 0,
			reposts: m?.reposts ?? 0,
			replies: m?.replies ?? 0,
			capturedAt: m?.capturedAt ? m.capturedAt.toISOString() : null,
		};
	});
}

/**
 * Full detail for one campaign: its brief, target/budget, independent KPI, and
 * the posts (broadcasts) + their latest cached metrics that produced it.
 * Returns `null` when the store is unconfigured or the campaign is unknown.
 *
 * @param userId - Session user id; the Postgres reads run under this user's RLS
 *   scope so the posts/metrics reflect only the user's own account(s).
 */
export async function getGrowthCampaign(
	campaignId: string,
	userId: string,
): Promise<CampaignDetail | null> {
	const container = getContainer();
	const store = container.knowledgeStorePort;
	if (!store) return null;

	const rows = await store.listKnowledge(DOMAIN_CAMPAIGNS, { limit: 200 });
	const h = rows.find(
		(r) =>
			r.entryType === "hypothesis" &&
			(r.id === `campaign:${campaignId}` ||
				campaignIdFromStrategy(r.resolutionStrategy) === campaignId),
	);
	if (!h) return null;

	const loaded = await loadCampaignSnapshots(campaignId, userId);
	const targetRate = targetRateFromContent(h.content);
	const effectiveTarget = targetRate ?? DEFAULT_TARGET_RATE;
	const kpi = computeEngagementKpi(loaded.snapshots, { rate: effectiveTarget });
	const layers = computeLayerBreakdown(loaded, effectiveTarget);
	const incoming = await store.listCitationsByCitedId(h.id);
	const resolved = incoming.some(
		(c) => c.citationType === "validates" || c.citationType === "invalidates",
	);
	const posts = await loadCampaignPosts(campaignId, userId);

	return {
		campaignId,
		hypothesisId: h.id,
		title: h.title,
		targetRate,
		evaluateAt: h.evaluateAt ? h.evaluateAt.toISOString() : null,
		confidencePct: h.confidencePct ?? null,
		resolved,
		score0to100: kpi.score0to100,
		edge: kpi.edge,
		observedRate: kpi.observedRate,
		basis: kpi.basis,
		snapshotCount: loaded.snapshots.length,
		postedBroadcasts: loaded.postedBroadcasts,
		layers,
		brief: h.content,
		posts,
	};
}
