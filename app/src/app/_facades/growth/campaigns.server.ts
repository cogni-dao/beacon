// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/_facades/growth/campaigns.server`
 * Purpose: Server-side facade for the read-only `/growth` lens — lists campaign
 *   hypotheses (domain `beacon-campaigns`) with their CURRENT engagement KPI
 *   computed independently from cached `post_metrics`.
 * Scope: Composes the `KnowledgeStorePort` (Doltgres) + service-role Postgres
 *   read + the pure `computeEngagementKpi`. No business logic beyond mapping;
 *   the KPI math lives in `@cogni/knowledge-store`.
 * Invariants:
 *   - PORT_VIA_CONTAINER: store/resolver pulled from the container.
 *   - KPI_NEVER_SELF_CITED: the surfaced KPI derives solely from `post_metrics`,
 *     never from the hypothesis confidence — the same pure fn the resolver uses.
 *   - READ_ONLY: no writes; the lens only observes the loop.
 * Side-effects: IO (Doltgres + Postgres reads via ports)
 * Links: docs/spec/beacon-growth-loop-v0.md §6, app/src/app/(app)/growth/view.tsx
 * @internal
 */

import {
  computeEngagementKpi,
  type EngagementBasis,
  type PostMetricSnapshot,
} from "@cogni/knowledge-store";
import { and, eq, inArray } from "drizzle-orm";

import { getServiceDb } from "@/adapters/server/db/drizzle.service-client";
import { getContainer } from "@/bootstrap/container";
import { broadcasts, postMetrics } from "@/shared/db/schema";

const DOMAIN_CAMPAIGNS = "beacon-campaigns";
const METRIC_ENGAGEMENT_PREFIX = "metric:engagement:";
const DEFAULT_TARGET_RATE = 0.02;

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
  strategy: string | null | undefined
): string | null {
  if (!strategy || !strategy.startsWith(METRIC_ENGAGEMENT_PREFIX)) return null;
  const id = strategy.slice(METRIC_ENGAGEMENT_PREFIX.length).trim();
  return id.length > 0 ? id : null;
}

async function loadCampaignSnapshots(campaignId: string): Promise<{
  snapshots: PostMetricSnapshot[];
  postedBroadcasts: number;
}> {
  const db = getServiceDb();
  const broadcastRows = await db
    .select({ id: broadcasts.id })
    .from(broadcasts)
    .where(
      and(eq(broadcasts.campaignId, campaignId), eq(broadcasts.status, "posted"))
    );
  const broadcastIds = broadcastRows.map((r) => r.id);
  if (broadcastIds.length === 0) {
    return { snapshots: [], postedBroadcasts: 0 };
  }

  const rows = await db
    .select({
      impressions: postMetrics.impressions,
      likes: postMetrics.likes,
      reposts: postMetrics.reposts,
      replies: postMetrics.replies,
      followersAtCapture: postMetrics.followersAtCapture,
    })
    .from(postMetrics)
    .where(inArray(postMetrics.broadcastId, broadcastIds));

  const snapshots: PostMetricSnapshot[] = rows.map((r) => ({
    impressions: r.impressions ?? null,
    likes: r.likes ?? 0,
    reposts: r.reposts ?? 0,
    replies: r.replies ?? 0,
    followersAtCapture: r.followersAtCapture ?? null,
  }));
  return { snapshots, postedBroadcasts: broadcastIds.length };
}

/**
 * List every campaign hypothesis in `beacon-campaigns` with its current,
 * independently-computed engagement KPI. Returns `[]` when the knowledge store
 * is unconfigured (DOLTGRES_URL unset) so the lens degrades gracefully.
 */
export async function listGrowthCampaigns(): Promise<CampaignLensRow[]> {
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

    const { snapshots, postedBroadcasts } =
      await loadCampaignSnapshots(campaignId);
    const targetRate = targetRateFromContent(h.content);
    const kpi = computeEngagementKpi(snapshots, {
      rate: targetRate ?? DEFAULT_TARGET_RATE,
    });

    const incoming = await store.listCitationsByCitedId(h.id);
    const resolved = incoming.some(
      (c) => c.citationType === "validates" || c.citationType === "invalidates"
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
      snapshotCount: snapshots.length,
      postedBroadcasts,
    });
  }

  // Stable order: unresolved (in-flight) first, then by title.
  out.sort((a, b) => {
    if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
    return a.title.localeCompare(b.title);
  });
  return out;
}
