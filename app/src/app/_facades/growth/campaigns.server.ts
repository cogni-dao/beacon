// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/_facades/growth/campaigns.server`
 * Purpose: Server-side facade for the `/growth` lens — lists the account-owned
 *   `campaigns` records (RLS-scoped) with their CURRENT engagement KPI computed
 *   independently from cached `post_metrics`. The lifecycle `status` is the owned
 *   column now, not a derivation from loop counters.
 * Scope: Composes an RLS-scoped Postgres read of `campaigns` + `posts` +
 *   `post_metrics` and the pure `computeEngagementKpi`. No business logic beyond
 *   mapping; the KPI math lives in `@cogni/knowledge-store`.
 * Invariants:
 *   - KPI_NEVER_SELF_CITED: the surfaced KPI derives solely from `post_metrics` —
 *     the same pure fn the resolver uses.
 *   - READ_ONLY: no writes; the lens only observes the loop (CRUD is the API route).
 *   - STATUS_FROM_TABLE: the lifecycle `status` is the owned `campaigns.status`
 *     column — NOT derived from post/snapshot counters.
 *   - RLS_SCOPED_READS: every read (campaigns/posts/post_metrics) runs inside
 *     `withTenantScope` under the session user's GUC — RLS filters rows to the user's
 *     billing account(s). NEVER the service-role DB (that leaks every account's rows).
 *     The campaign LIST now comes from the owned Postgres table (the campaigns→Postgres
 *     tenancy gap is closed).
 * Side-effects: IO (Postgres reads via the RLS-scoped client)
 * Links: docs/spec/beacon-growth-loop-v0.md §6, app/src/app/(app)/growth/view.tsx
 * @internal
 */

import {
	deriveMoltbookPayloadFromDraft,
	type MoltbookPostPayload,
} from "@cogni/ai-tools";
import { withTenantScope } from "@cogni/db-client";
import { connections } from "@cogni/db-schema";
import { type UserId, userActor } from "@cogni/ids";
import {
	computeEngagementKpi,
	type EngagementBasis,
	type PostMetricSnapshot,
} from "@cogni/knowledge-store";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { resolveAppDb } from "@/bootstrap/container";
import { campaigns, postMetrics, posts } from "@/shared/db/schema";

import { FUNNEL_LAYERS, type FunnelLayer } from "./campaigns.shared";

const DEFAULT_TARGET_RATE = 0.02;

/** Lifecycle status of the owned campaign record (mirrors the CHECK constraint). */
export const CAMPAIGN_STATUSES = [
	"draft",
	"active",
	"paused",
	"done",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** Normalize a raw `status` value to a known status (defaults to draft). */
function asCampaignStatus(raw: string | null | undefined): CampaignStatus {
	return (CAMPAIGN_STATUSES as readonly string[]).includes(raw ?? "")
		? (raw as CampaignStatus)
		: "draft";
}

// Funnel layers live in the CLIENT-SAFE campaigns.shared (no server deps) so the
// "use client" funnel UI can import the value without dragging this server module
// (db/LLM) into the browser bundle. Re-exported here for existing server callers.
export { FUNNEL_LAYERS, type FunnelLayer } from "./campaigns.shared";

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
	title: string;
	/** Owned lifecycle status from the `campaigns` table (not derived). */
	status: CampaignStatus;
	targetRate: number | null;
	evaluateAt: string | null;
	createdAt: string;
	score0to100: number;
	edge: "validates" | "invalidates";
	observedRate: number;
	basis: EngagementBasis;
	snapshotCount: number;
	postedBroadcasts: number;
	/** Independent KPI computed PER funnel layer (tofu/mofu/bofu). */
	layers: FunnelLayerBreakdown;
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
		const postRows = await tx
			.select({ id: posts.id, funnelLayer: posts.funnelLayer })
			.from(posts)
			.where(
				and(
					eq(posts.campaignId, campaignId),
					eq(posts.status, "posted"),
				),
			);

		if (postRows.length === 0) {
			return { snapshots: [], postedBroadcasts: 0, byLayer, postedByLayer };
		}

		const layerOf = new Map<string, FunnelLayer>();
		for (const r of postRows) {
			const layer = asFunnelLayer(r.funnelLayer);
			layerOf.set(r.id, layer);
			postedByLayer[layer] += 1;
		}
		const postIds = postRows.map((r) => r.id);

		const rows = await tx
			.select({
				postId: postMetrics.postId,
				impressions: postMetrics.impressions,
				likes: postMetrics.likes,
				reposts: postMetrics.reposts,
				replies: postMetrics.replies,
				followersAtCapture: postMetrics.followersAtCapture,
			})
			.from(postMetrics)
			.where(inArray(postMetrics.postId, postIds));

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
			const layer = layerOf.get(r.postId) ?? "tofu";
			byLayer[layer].push(snapshot);
		}

		return {
			snapshots,
			postedBroadcasts: postIds.length,
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

/** One owned campaign record, read RLS-scoped from the `campaigns` table. */
interface CampaignRecord {
	campaignId: string;
	title: string;
	status: CampaignStatus;
	brief: string | null;
	targetRate: number | null;
	evaluateAt: string | null;
	createdAt: string;
}

/** RLS-scoped read of the account's `campaigns` rows, newest first. */
async function loadCampaignRecords(userId: string): Promise<CampaignRecord[]> {
	const db = resolveAppDb();
	const actorId = userActor(userId as UserId);

	const rows = await withTenantScope(db, actorId, async (tx) =>
		tx
			.select({
				campaignId: campaigns.campaignId,
				title: campaigns.title,
				status: campaigns.status,
				brief: campaigns.brief,
				targetRate: campaigns.targetRate,
				evaluateAt: campaigns.evaluateAt,
				createdAt: campaigns.createdAt,
			})
			.from(campaigns)
			.orderBy(desc(campaigns.createdAt)),
	);

	return rows.map((r) => ({
		campaignId: r.campaignId,
		title: r.title,
		status: asCampaignStatus(r.status),
		brief: r.brief ?? null,
		targetRate: r.targetRate ?? null,
		evaluateAt: r.evaluateAt ? r.evaluateAt.toISOString() : null,
		createdAt: r.createdAt.toISOString(),
	}));
}

/**
 * List the account-owned `campaigns` records (RLS-scoped to the session user)
 * with each campaign's current, independently-computed engagement KPI.
 *
 * @param userId - Session user id; the Postgres reads run under this user's RLS
 *   scope so the list + KPI reflect only the user's own account(s).
 */
export async function listGrowthCampaigns(
	userId: string,
): Promise<CampaignLensRow[]> {
	const records = await loadCampaignRecords(userId);

	const out: CampaignLensRow[] = [];
	for (const rec of records) {
		const loaded = await loadCampaignSnapshots(rec.campaignId, userId);
		const effectiveTarget = rec.targetRate ?? DEFAULT_TARGET_RATE;
		const kpi = computeEngagementKpi(loaded.snapshots, {
			rate: effectiveTarget,
		});
		const layers = computeLayerBreakdown(loaded, effectiveTarget);

		out.push({
			campaignId: rec.campaignId,
			title: rec.title,
			status: rec.status,
			targetRate: rec.targetRate,
			evaluateAt: rec.evaluateAt,
			createdAt: rec.createdAt,
			score0to100: kpi.score0to100,
			edge: kpi.edge,
			observedRate: kpi.observedRate,
			basis: kpi.basis,
			snapshotCount: loaded.snapshots.length,
			postedBroadcasts: loaded.postedBroadcasts,
			layers,
		});
	}

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
	moltbook: MoltbookPostPayload | null;
	moltbookPayloadPersisted: boolean;
	status: string;
	/** AI quality score from the critique pass (0–1), if present. */
	score: number | null;
	/** Count of critique→edit revision passes; 0 for first draft. */
	revision: number;
	externalPostId: string | null;
	externalPostUrl: string | null;
	postedAt: string | null;
	impressions: number | null;
	likes: number;
	reposts: number;
	replies: number;
	capturedAt: string | null;
}

/** Full detail for one campaign — the lens row plus its brief and posts. */
export interface CampaignDetail extends CampaignLensRow {
	/** The campaign brief / goal (owned `campaigns.brief`); "" when unset. */
	brief: string;
	moltbookConnection: {
		handle: string | null;
		displayLabel: string | null;
	} | null;
	posts: CampaignPost[];
}

/** RLS-scoped read of a single owned campaign record by slug. */
async function loadCampaignRecord(
	campaignId: string,
	userId: string,
): Promise<CampaignRecord | null> {
	const db = resolveAppDb();
	const actorId = userActor(userId as UserId);

	const rows = await withTenantScope(db, actorId, async (tx) =>
		tx
			.select({
				campaignId: campaigns.campaignId,
				title: campaigns.title,
				status: campaigns.status,
				brief: campaigns.brief,
				targetRate: campaigns.targetRate,
				evaluateAt: campaigns.evaluateAt,
				createdAt: campaigns.createdAt,
			})
			.from(campaigns)
			.where(eq(campaigns.campaignId, campaignId))
			.limit(1),
	);
	const r = rows[0];
	if (!r) return null;
	return {
		campaignId: r.campaignId,
		title: r.title,
		status: asCampaignStatus(r.status),
		brief: r.brief ?? null,
		targetRate: r.targetRate ?? null,
		evaluateAt: r.evaluateAt ? r.evaluateAt.toISOString() : null,
		createdAt: r.createdAt.toISOString(),
	};
}

async function loadCampaignPosts(
	campaignId: string,
	userId: string,
): Promise<CampaignPost[]> {
	const db = resolveAppDb();
	const actorId = userActor(userId as UserId);

	// RLS_SCOPED_READS: filter to the session user's account(s) via the GUC.
	const { rows, latest } = await withTenantScope(db, actorId, async (tx) => {
		const postRows = await tx
			.select({
				id: posts.id,
				channel: posts.channel,
				funnelLayer: posts.funnelLayer,
				topic: posts.topic,
				angle: posts.angle,
				text: posts.text,
				moltbookSubmoltName: posts.moltbookSubmoltName,
				moltbookTitle: posts.moltbookTitle,
				moltbookContent: posts.moltbookContent,
				moltbookType: posts.moltbookType,
				status: posts.status,
				score: posts.score,
				revision: posts.revision,
				externalPostId: posts.externalPostId,
				externalPostUrl: posts.externalPostUrl,
				postedAt: posts.postedAt,
			})
			.from(posts)
			.where(eq(posts.campaignId, campaignId));
		if (postRows.length === 0) {
			return { rows: postRows, latest: new Map<string, never>() };
		}

		const ids = postRows.map((r) => r.id);
		const metricRows = await tx
			.select({
				postId: postMetrics.postId,
				capturedAt: postMetrics.capturedAt,
				impressions: postMetrics.impressions,
				likes: postMetrics.likes,
				reposts: postMetrics.reposts,
				replies: postMetrics.replies,
			})
			.from(postMetrics)
			.where(inArray(postMetrics.postId, ids));

		// Keep only the latest snapshot per post.
		const latestByPost = new Map<string, (typeof metricRows)[number]>();
		for (const m of metricRows) {
			const cur = latestByPost.get(m.postId);
			if (
				!cur ||
				(m.capturedAt?.getTime() ?? 0) > (cur.capturedAt?.getTime() ?? 0)
			) {
				latestByPost.set(m.postId, m);
			}
		}
		return { rows: postRows, latest: latestByPost };
	});

	if (rows.length === 0) return [];

	return rows.map((r) => {
		const m = latest.get(r.id);
		const hasPersistedMoltbookPayload = Boolean(
			r.moltbookSubmoltName &&
				r.moltbookTitle &&
				r.moltbookContent &&
				r.moltbookType === "text",
		);
		const moltbook =
			r.channel === "moltbook"
				? hasPersistedMoltbookPayload
					? {
							submoltName: r.moltbookSubmoltName ?? "general",
							title: r.moltbookTitle ?? "",
							content: r.moltbookContent ?? "",
							type: "text" as const,
						}
					: deriveMoltbookPayloadFromDraft({
							text: r.text,
							...(r.angle ? { angle: r.angle } : {}),
							...(r.topic ? { topic: r.topic } : {}),
						})
				: null;
		return {
			id: r.id,
			channel: r.channel,
			funnelLayer: asFunnelLayer(r.funnelLayer),
			topic: r.topic ?? null,
			angle: r.angle ?? null,
			text: r.text,
			moltbook,
			moltbookPayloadPersisted: hasPersistedMoltbookPayload,
			status: r.status,
			score: r.score ?? null,
			revision: r.revision ?? 0,
			externalPostId: r.externalPostId ?? null,
			externalPostUrl: r.externalPostUrl ?? null,
			postedAt: r.postedAt ? r.postedAt.toISOString() : null,
			impressions: m?.impressions ?? null,
			likes: m?.likes ?? 0,
			reposts: m?.reposts ?? 0,
			replies: m?.replies ?? 0,
			capturedAt: m?.capturedAt ? m.capturedAt.toISOString() : null,
		};
	});
}

async function loadMoltbookConnection(
	userId: string,
): Promise<CampaignDetail["moltbookConnection"]> {
	const db = resolveAppDb();
	const actorId = userActor(userId as UserId);
	const rows = await withTenantScope(db, actorId, async (tx) =>
		tx
			.select({
				handle: connections.externalHandle,
				displayLabel: connections.displayLabel,
			})
			.from(connections)
			.where(
				and(
					eq(connections.provider, "moltbook"),
					eq(connections.status, "active"),
					isNull(connections.revokedAt),
				),
			)
			.limit(1),
	);
	const row = rows[0];
	return row ? { handle: row.handle, displayLabel: row.displayLabel } : null;
}

/**
 * Full detail for one owned campaign: its brief, target/budget, lifecycle status,
 * independent KPI, and the posts (broadcasts) + their latest cached metrics that
 * produced it. Returns `null` when the campaign is unknown to the user's account.
 *
 * @param userId - Session user id; the Postgres reads run under this user's RLS
 *   scope so the record/posts/metrics reflect only the user's own account(s).
 */
export async function getGrowthCampaign(
	campaignId: string,
	userId: string,
): Promise<CampaignDetail | null> {
	const rec = await loadCampaignRecord(campaignId, userId);
	if (!rec) return null;

	const loaded = await loadCampaignSnapshots(campaignId, userId);
	const effectiveTarget = rec.targetRate ?? DEFAULT_TARGET_RATE;
	const kpi = computeEngagementKpi(loaded.snapshots, { rate: effectiveTarget });
	const layers = computeLayerBreakdown(loaded, effectiveTarget);
	const posts = await loadCampaignPosts(campaignId, userId);
	const moltbookConnection = await loadMoltbookConnection(userId);

	return {
		campaignId: rec.campaignId,
		title: rec.title,
		status: rec.status,
		targetRate: rec.targetRate,
		evaluateAt: rec.evaluateAt,
		createdAt: rec.createdAt,
		score0to100: kpi.score0to100,
		edge: kpi.edge,
		observedRate: kpi.observedRate,
		basis: kpi.basis,
		snapshotCount: loaded.snapshots.length,
		postedBroadcasts: loaded.postedBroadcasts,
		layers,
		brief: rec.brief ?? "",
		moltbookConnection,
		posts,
	};
}
