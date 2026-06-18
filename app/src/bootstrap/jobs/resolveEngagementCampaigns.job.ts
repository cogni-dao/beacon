// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/jobs/resolveEngagementCampaigns.job`
 * Purpose: The growth-loop VERIFIER bridge. Drives the `metric:`-strategy
 *   resolver path: finds due campaign hypotheses (`resolution_strategy =
 *   'metric:engagement:<campaignId>'`), loads that campaign's cached
 *   `post_metrics` from Postgres, computes the INDEPENDENT engagement KPI, and
 *   resolves the hypothesis (idempotent). On every resolution it files a
 *   `beacon-post-performance` finding with an `evidence_for` (`op:cite`) edge to
 *   the campaign; on `validates` it distills/updates a `beacon-brand-voice`
 *   rule.
 * Scope: Orchestration only. The edge is computed by the pure
 *   `computeEngagementKpi` (knowledge-store); all Doltgres writes go through the
 *   `KnowledgeStorePort` + `EdoResolverPort` (no hand-rolled Doltgres SQL).
 * Invariants:
 *   - KPI_NEVER_SELF_CITED: the validates/invalidates edge derives SOLELY from
 *     `post_metrics` via `computeEngagementKpi`; the hypothesis's own confidence
 *     is never read.
 *   - RESOLVER_DELEGATES_IDEMPOTENT: outcome rows are written ONLY via
 *     `edoResolver.resolveHypothesis` (idempotent); this job never writes
 *     outcome/citation rows for the resolution directly.
 *   - SERVICE_ROLE_NO_RLS: `post_metrics` reads use the service-role DB.
 *   - METRIC_STRATEGY_ONLY: only `metric:engagement:*` hypotheses are touched.
 * Side-effects: IO (Postgres reads, Doltgres reads/writes + commits via ports)
 * Links: docs/spec/beacon-growth-loop-v0.md §6, .context/specs/pr3-verifier.md
 * @public
 */

import {
  computeEngagementKpi,
  type EngagementBasis,
  type EngagementTarget,
  type PostMetricSnapshot,
} from "@cogni/knowledge-store";
import { and, eq, inArray } from "drizzle-orm";

import { getServiceDb } from "@/adapters/server/db/drizzle.service-client";
import { getContainer } from "@/bootstrap/container";
import { postMetrics, posts } from "@/shared/db/schema";

/** Strategy namespace this job owns. */
const METRIC_ENGAGEMENT_PREFIX = "metric:engagement:";

/** Knowledge domains for the growth loop (registered in PR1). */
const DOMAIN_POST_PERFORMANCE = "beacon-post-performance";
const DOMAIN_BRAND_VOICE = "beacon-brand-voice";

/** Default engagement-rate target when the hypothesis encodes none. */
const DEFAULT_TARGET_RATE = 0.02;

/** Bound the resolver fan-out per tick. */
const MAX_CAMPAIGNS_PER_RUN = 25;

/** Per-campaign resolution result for the run summary. */
export interface CampaignResolution {
  campaignId: string;
  hypothesisId: string;
  edge: "validates" | "invalidates";
  score0to100: number;
  basis: EngagementBasis;
  resolvedConfidence: number;
  alreadyResolved: boolean;
  snapshotCount: number;
}

/** Summary of one resolve run. */
export interface ResolveEngagementCampaignsSummary {
  /** Due `metric:engagement:*` hypotheses considered. */
  considered: number;
  /** Hypotheses resolved this run (validates+invalidates, excludes already-resolved). */
  resolved: number;
  /** Per-campaign breakdown. */
  resolutions: CampaignResolution[];
}

/**
 * Parse `metric:engagement:<campaignId>` → `<campaignId>`. Returns null for any
 * strategy this job does not own.
 */
function parseCampaignId(strategy: string | null | undefined): string | null {
  if (!strategy || !strategy.startsWith(METRIC_ENGAGEMENT_PREFIX)) return null;
  const id = strategy.slice(METRIC_ENGAGEMENT_PREFIX.length).trim();
  return id.length > 0 ? id : null;
}

/**
 * Read the verification target from the hypothesis row. The hypothesis content
 * is the durable home for the predicted rate; if it carries a JSON-ish
 * `target_rate` hint we honor it, else fall back to the default. The target is
 * NOT the hypothesis confidence — it is the prediction the KPI checks against.
 */
function targetFromHypothesis(content: string | null): EngagementTarget {
  if (content) {
    const m = content.match(/target[_\s-]?rate["\s:=]+([0-9]*\.?[0-9]+)/i);
    if (m?.[1]) {
      const rate = Number(m[1]);
      if (Number.isFinite(rate) && rate > 0 && rate <= 1) return { rate };
    }
  }
  return { rate: DEFAULT_TARGET_RATE };
}

/**
 * Load every cached `post_metrics` snapshot for one campaign's posted
 * posts (service-role; no RLS in growth v0). Snapshots are reduced to the
 * plane-agnostic `PostMetricSnapshot` shape the pure KPI consumes.
 */
async function loadCampaignSnapshots(
  campaignId: string
): Promise<PostMetricSnapshot[]> {
  const db = getServiceDb();
  const postRows = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.campaignId, campaignId), eq(posts.status, "posted")));
  const postIds = postRows.map((r) => r.id);
  if (postIds.length === 0) return [];

  const rows = await db
    .select({
      impressions: postMetrics.impressions,
      likes: postMetrics.likes,
      reposts: postMetrics.reposts,
      replies: postMetrics.replies,
      followersAtCapture: postMetrics.followersAtCapture,
    })
    .from(postMetrics)
    .where(inArray(postMetrics.postId, postIds));

  return rows.map((r) => ({
    impressions: r.impressions ?? null,
    likes: r.likes ?? 0,
    reposts: r.reposts ?? 0,
    replies: r.replies ?? 0,
    followersAtCapture: r.followersAtCapture ?? null,
  }));
}

/**
 * Run the engagement-campaign resolver bridge.
 *
 * 1. `pendingResolutions(now, {strategy:'metric:'})` → due automated hypotheses.
 * 2. Filter to `metric:engagement:*` and parse the campaign id.
 * 3. Load that campaign's `post_metrics` (Postgres).
 * 4. `computeEngagementKpi` → independent {score, edge}.
 * 5. `resolveHypothesis(edge)` — idempotent; writes the outcome + recomputes
 *    confidence.
 * 6. File a `beacon-post-performance` finding with an `evidence_for` (op:cite)
 *    edge to the campaign hypothesis. On `validates`, distill/update a
 *    `beacon-brand-voice` rule.
 */
export async function runResolveEngagementCampaignsJob(
  now: Date = new Date()
): Promise<ResolveEngagementCampaignsSummary> {
  const container = getContainer();
  const { log, edoResolver, knowledgeStorePort } = container;
  if (!edoResolver || !knowledgeStorePort) {
    throw new Error(
      "resolveEngagementCampaigns: knowledge store not configured (DOLTGRES_URL unset)"
    );
  }

  // 1+2. Due hypotheses opted into the metric: resolver.
  const due = await edoResolver.pendingResolutions(now, {
    strategy: "metric:",
    limit: MAX_CAMPAIGNS_PER_RUN,
  });

  const resolutions: CampaignResolution[] = [];
  let resolved = 0;
  let considered = 0;

  for (const hypothesis of due) {
    const campaignId = parseCampaignId(hypothesis.resolutionStrategy);
    if (!campaignId) continue; // not an engagement campaign
    considered++;

    // 3. Cached ground-truth.
    const snapshots = await loadCampaignSnapshots(campaignId);

    // 4. INDEPENDENT verdict — pure, never reads the hypothesis confidence.
    const target = targetFromHypothesis(hypothesis.content);
    const kpi = computeEngagementKpi(snapshots, target);

    // 5. Delegate to the idempotent resolver (writes outcome + citation +
    //    recompute + commit). This job NEVER writes outcome rows directly.
    const resolution = await edoResolver.resolveHypothesis({
      hypothesisId: hypothesis.id,
      domain: hypothesis.domain,
      outcomeId: `outcome:${hypothesis.id}`,
      outcomeTitle: `Engagement KPI ${kpi.score0to100}/100 (${kpi.edge})`,
      outcomeContent: `KPI=${kpi.score0to100}/100 vs target; observed engagement rate ${kpi.observedRate.toFixed(
        4
      )} (${kpi.basis}); ${snapshots.length} snapshot(s).`,
      edge: kpi.edge,
      sourceType: "analysis_signal",
      sourceRef: `kpi:engagement:${campaignId}`,
      sourceNode: "growth-resolver",
    });

    if (!resolution.alreadyResolved) {
      resolved++;
      // 6. File a beacon-post-performance finding + op:cite (evidence_for)
      //    edge to the campaign. Idempotent on the deterministic id.
      await fileFindingAndRule({
        store: knowledgeStorePort,
        campaignId,
        hypothesisId: hypothesis.id,
        score: kpi.score0to100,
        edge: kpi.edge,
        observedRate: kpi.observedRate,
        basis: kpi.basis,
        snapshotCount: snapshots.length,
      });
    }

    resolutions.push({
      campaignId,
      hypothesisId: hypothesis.id,
      edge: kpi.edge,
      score0to100: kpi.score0to100,
      basis: kpi.basis,
      resolvedConfidence: resolution.resolvedConfidence,
      alreadyResolved: resolution.alreadyResolved,
      snapshotCount: snapshots.length,
    });

    log.info(
      {
        campaignId,
        hypothesisId: hypothesis.id,
        edge: kpi.edge,
        score: kpi.score0to100,
        basis: kpi.basis,
        alreadyResolved: resolution.alreadyResolved,
        resolvedConfidence: resolution.resolvedConfidence,
      },
      "growth.campaign.resolved"
    );
  }

  const summary: ResolveEngagementCampaignsSummary = {
    considered,
    resolved,
    resolutions,
  };
  log.info(summary, "growth.resolve complete");
  return summary;
}

/**
 * File the `beacon-post-performance` finding (sourceRef=broadcast) with an
 * `evidence_for` / `op:cite` edge to the campaign hypothesis, and — when the
 * campaign validated — distill/update a `beacon-brand-voice` rule. All writes
 * go through the `KnowledgeStorePort` (no hand-rolled SQL); ids are
 * deterministic for idempotency, and a single commit closes the surface.
 */
async function fileFindingAndRule(args: {
  store: NonNullable<ReturnType<typeof getContainer>["knowledgeStorePort"]>;
  campaignId: string;
  hypothesisId: string;
  score: number;
  edge: "validates" | "invalidates";
  observedRate: number;
  basis: string;
  snapshotCount: number;
}): Promise<void> {
  const {
    store,
    campaignId,
    hypothesisId,
    score,
    edge,
    observedRate,
    basis,
    snapshotCount,
  } = args;

  const findingId = `finding:perf:${campaignId}`;
  if (!(await store.knowledgeExists(findingId))) {
    await store.addKnowledge({
      id: findingId,
      domain: DOMAIN_POST_PERFORMANCE,
      title: `Campaign ${campaignId} engagement ${score}/100 (${edge})`,
      content: `Independent KPI for campaign '${campaignId}': score ${score}/100, observed rate ${observedRate.toFixed(
        4
      )} (${basis}) over ${snapshotCount} snapshot(s). Derived solely from cached post_metrics (broadcast ground-truth).`,
      entryType: "finding",
      sourceType: "analysis_signal",
      // sourceRef points at the broadcast plane that produced the ground-truth.
      sourceRef: `broadcast:campaign:${campaignId}`,
      tags: ["growth-loop", "engagement", basis],
      confidencePct: null,
    });

    // op:cite — evidence_for edge from the finding to the campaign hypothesis.
    await store.addCitation({
      citingId: findingId,
      citedId: hypothesisId,
      citationType: "evidence_for",
      context: `engagement KPI ${score}/100 (${edge}) from cached post_metrics`,
    });
  }

  // On validation, distill/update a durable brand-voice rule.
  if (edge === "validates") {
    const ruleId = `rule:brand-voice:${campaignId}`;
    if (await store.knowledgeExists(ruleId)) {
      await store.updateKnowledge(ruleId, {
        content: `Validated angle for campaign '${campaignId}': hit the engagement target (KPI ${score}/100, rate ${observedRate.toFixed(
          4
        )} via ${basis}). Reuse this angle/hook/format for the audience+channel.`,
      });
    } else {
      await store.addKnowledge({
        id: ruleId,
        domain: DOMAIN_BRAND_VOICE,
        title: `Winning angle — campaign ${campaignId}`,
        content: `Validated angle for campaign '${campaignId}': hit the engagement target (KPI ${score}/100, rate ${observedRate.toFixed(
          4
        )} via ${basis}). Reuse this angle/hook/format for the audience+channel.`,
        entryType: "rule",
        sourceType: "derived",
        sourceRef: `campaign:${campaignId}`,
        tags: ["growth-loop", "brand-voice", "validated"],
        confidencePct: null,
      });
    }
    // The brand-voice rule supports the campaign hypothesis (op:cite). Guard
    // with the deterministic edge id so re-runs are no-ops.
    await store.addCitation({
      citingId: ruleId,
      citedId: hypothesisId,
      citationType: "supports",
      context: `distilled brand-voice rule from validated campaign ${campaignId}`,
    });
  }

  await store.commit(
    `growth: file ${DOMAIN_POST_PERFORMANCE} finding for campaign ${campaignId} (${edge})`
  );
}
