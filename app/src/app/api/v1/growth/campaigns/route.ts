// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/growth/campaigns`
 * Purpose: Campaign collection surface — the growth-loop PLAN beat.
 *   `POST` files a falsifiable campaign hypothesis in the EDO substrate
 *   (domain `beacon-campaigns`, strategy `metric:engagement:<x>`) AND provisions
 *   a Temporal content schedule (`langgraph:content`) whose brief recalls
 *   `beacon-brand-voice`. `GET` lists campaigns with their CURRENT engagement KPI
 *   (computed independently from cached `post_metrics`).
 * Scope: HTTP boundary + Zod validation + orchestration. Reuses the EDO
 *   capability (no new goal table) and the schedule manager. The KPI is the
 *   same pure `computeEngagementKpi` the resolver bridge uses.
 * Invariants:
 *   - AUTH_VIA_SESSION: session-cookie required (humans trusted in v0, mirrors
 *     the session path of `POST /api/v1/edo/hypothesize`).
 *   - REUSE_EDO_NO_GOAL_TABLE: the campaign IS the hypothesis row.
 *   - METRIC_STRATEGY: every campaign hypothesis opts into
 *     `resolution_strategy = 'metric:engagement:<campaignId>'`.
 *   - KPI_NEVER_SELF_CITED: the listed KPI derives solely from `post_metrics`.
 * Side-effects: IO (HTTP, Doltgres write via edoCapability, Postgres read,
 *   schedule create via Temporal).
 * Links: docs/spec/beacon-growth-loop-v0.md §1/§6, .context/specs/pr3-verifier.md
 * @public
 */

import {
  computeEngagementKpi,
  type EngagementBasis,
  type PostMetricSnapshot,
} from "@cogni/knowledge-store";
import { toUserId } from "@cogni/ids";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getServiceDb } from "@/adapters/server/db/drizzle.service-client";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { getNodeId } from "@/shared/config";
import { broadcasts, postMetrics } from "@/shared/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DOMAIN_CAMPAIGNS = "beacon-campaigns";
const CONTENT_GRAPH_ID = "langgraph:content";
const METRIC_ENGAGEMENT_PREFIX = "metric:engagement:";
const CAMPAIGN_HYPOTHESIS_CONFIDENCE = 30;
/** Slug-safe campaign id charset. */
const CAMPAIGN_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** Default cadence for the content sub-loop (daily, UTC) — operator-tunable later. */
const DEFAULT_CONTENT_CRON = "0 13 * * *";
const DEFAULT_TIMEZONE = "UTC";

// ---------------------------------------------------------------------------
// Wire contracts (Zod boundaries)
// ---------------------------------------------------------------------------

const CreateCampaignInputSchema = z.object({
  /** Slug for the campaign — becomes `campaign:<id>` + `metric:engagement:<id>`. */
  campaignId: z
    .string()
    .regex(CAMPAIGN_ID_RE, "campaignId must be a lowercase slug (a-z0-9-)"),
  title: z.string().min(1).max(200),
  /** The audience + angle + funnel-stage framing of the hypothesis. */
  brief: z.string().min(1).max(4000),
  /** Predicted engagement RATE the campaign must hit, fraction in (0,1]. */
  targetRate: z.number().positive().max(1),
  /** Budget deadline — when the hypothesis resolves (ISO 8601). */
  evaluateAt: z.string().datetime(),
  /** Cron for the content schedule. Defaults to daily 13:00 UTC. */
  cron: z.string().min(1).max(120).optional(),
  timezone: z.string().min(1).max(64).optional(),
  /** Skip provisioning the Temporal content schedule (file the hypothesis only). */
  skipSchedule: z.boolean().optional(),
});

const CampaignKpiSchema = z.object({
  score0to100: z.number(),
  edge: z.enum(["validates", "invalidates"]),
  observedRate: z.number(),
  basis: z.enum(["impressions", "followers", "none"]),
  snapshotCount: z.number().int().nonnegative(),
  postedBroadcasts: z.number().int().nonnegative(),
});

const CampaignSummarySchema = z.object({
  campaignId: z.string(),
  hypothesisId: z.string(),
  title: z.string(),
  targetRate: z.number().nullable(),
  evaluateAt: z.string().nullable(),
  confidencePct: z.number().nullable(),
  resolved: z.boolean(),
  kpi: CampaignKpiSchema,
});

const CampaignsListOutputSchema = z.object({
  campaigns: z.array(CampaignSummarySchema),
});

export type CampaignSummary = z.infer<typeof CampaignSummarySchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a `target_rate` hint out of hypothesis content (mirrors the bridge job). */
function targetRateFromContent(content: string): number | null {
  const m = content.match(/target[_\s-]?rate["\s:=]+([0-9]*\.?[0-9]+)/i);
  if (m?.[1]) {
    const rate = Number(m[1]);
    if (Number.isFinite(rate) && rate > 0 && rate <= 1) return rate;
  }
  return null;
}

/**
 * Load every cached `post_metrics` snapshot for one campaign's posted
 * broadcasts (service-role; no RLS in growth v0). Identical reduction to the
 * resolver bridge so the lens KPI matches the resolution KPI exactly.
 */
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

function campaignIdFromStrategy(
  strategy: string | null | undefined
): string | null {
  if (!strategy || !strategy.startsWith(METRIC_ENGAGEMENT_PREFIX)) return null;
  const id = strategy.slice(METRIC_ENGAGEMENT_PREFIX.length).trim();
  return id.length > 0 ? id : null;
}

// ---------------------------------------------------------------------------
// POST /api/v1/growth/campaigns — PLAN: file hypothesis + content schedule
// ---------------------------------------------------------------------------

export const POST = wrapRouteHandlerWithLogging(
  { routeId: "growth.campaigns.create", auth: { mode: "required", getSessionUser } },
  async (ctx, request, sessionUser) => {
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
    }

    const parsed = CreateCampaignInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid input", issues: parsed.error.issues },
        { status: 400 }
      );
    }
    const input = parsed.data;

    const container = getContainer();
    const edo = container.edoCapability;

    const hypothesisId = `campaign:${input.campaignId}`;
    const resolutionStrategy = `${METRIC_ENGAGEMENT_PREFIX}${input.campaignId}`;
    const evaluateAt = new Date(input.evaluateAt);

    // The hypothesis content is the durable home for the predicted rate; the
    // resolver parses `target_rate` from it. Brief recalls brand-voice.
    const content = [
      input.brief.trim(),
      "",
      `target_rate=${input.targetRate}`,
      `Recall beacon-brand-voice for winning angles/hooks/formats before producing.`,
    ].join("\n");

    try {
      const hypothesis = await edo.hypothesize({
        id: hypothesisId,
        domain: DOMAIN_CAMPAIGNS,
        title: input.title,
        content,
        evaluateAt,
        resolutionStrategy,
        sourceType: "human",
        sourceRef: `principal:${sessionUser.id}`,
        sourceNode: "operator",
        tags: ["growth-loop", "campaign"],
        confidencePct: CAMPAIGN_HYPOTHESIS_CONFIDENCE,
      });

      let scheduleId: string | null = null;
      if (!input.skipSchedule) {
        const accountService = container.accountsForUser(
          toUserId(sessionUser.id)
        );
        const account = await accountService.getOrCreateBillingAccountForUser({
          userId: sessionUser.id,
        });
        const schedule = await container.scheduleManager.createSchedule(
          toUserId(sessionUser.id),
          account.id,
          {
            nodeId: getNodeId(),
            graphId: CONTENT_GRAPH_ID,
            input: {
              campaignId: input.campaignId,
              brief: input.brief,
              recall: "beacon-brand-voice",
            },
            cron: input.cron ?? DEFAULT_CONTENT_CRON,
            timezone: input.timezone ?? DEFAULT_TIMEZONE,
          }
        );
        scheduleId = schedule.id;
      }

      ctx.log.info(
        {
          route: "growth.campaigns.create",
          campaignId: input.campaignId,
          hypothesisId,
          resolutionStrategy,
          scheduleId,
        },
        "growth.campaign.created"
      );

      return NextResponse.json(
        {
          campaignId: input.campaignId,
          hypothesisId: hypothesis.id,
          resolutionStrategy,
          evaluateAt: input.evaluateAt,
          scheduleId,
          committed: true,
        },
        { status: 201 }
      );
    } catch (e) {
      if (e instanceof Error && /duplicate key/i.test(e.message)) {
        return NextResponse.json(
          { error: `campaign '${input.campaignId}' already exists` },
          { status: 409 }
        );
      }
      throw e;
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/v1/growth/campaigns — list campaigns with current KPI
// ---------------------------------------------------------------------------

export const GET = wrapRouteHandlerWithLogging(
  { routeId: "growth.campaigns.list", auth: { mode: "required", getSessionUser } },
  async (ctx, _request, sessionUser) => {
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const container = getContainer();
    const store = container.knowledgeStorePort;
    const resolver = container.edoResolver;
    if (!store || !resolver) {
      // Knowledge store unconfigured (DOLTGRES_URL unset) — no campaigns yet.
      return NextResponse.json(
        CampaignsListOutputSchema.parse({ campaigns: [] }),
        { status: 200 }
      );
    }

    const rows = await store.listKnowledge(DOMAIN_CAMPAIGNS, { limit: 200 });
    const hypotheses = rows.filter((r) => r.entryType === "hypothesis");

    const campaigns: CampaignSummary[] = [];
    for (const h of hypotheses) {
      const campaignId =
        campaignIdFromStrategy(h.resolutionStrategy) ??
        (h.id.startsWith("campaign:") ? h.id.slice("campaign:".length) : null);
      if (!campaignId) continue;

      const { snapshots, postedBroadcasts } =
        await loadCampaignSnapshots(campaignId);
      const targetRate = targetRateFromContent(h.content);
      const kpi = computeEngagementKpi(snapshots, {
        rate: targetRate ?? 0.02,
      });

      // Resolved iff an incoming validates/invalidates citation exists.
      const incoming = await store.listCitationsByCitedId(h.id);
      const resolved = incoming.some(
        (c) =>
          c.citationType === "validates" || c.citationType === "invalidates"
      );

      const basis: EngagementBasis = kpi.basis;
      campaigns.push({
        campaignId,
        hypothesisId: h.id,
        title: h.title,
        targetRate,
        evaluateAt: h.evaluateAt ? h.evaluateAt.toISOString() : null,
        confidencePct: h.confidencePct ?? null,
        resolved,
        kpi: {
          score0to100: kpi.score0to100,
          edge: kpi.edge,
          observedRate: kpi.observedRate,
          basis,
          snapshotCount: snapshots.length,
          postedBroadcasts,
        },
      });
    }

    ctx.log.info(
      { route: "growth.campaigns.list", count: campaigns.length },
      "growth.campaigns.list_success"
    );

    return NextResponse.json(
      CampaignsListOutputSchema.parse({ campaigns }),
      { status: 200 }
    );
  }
);
