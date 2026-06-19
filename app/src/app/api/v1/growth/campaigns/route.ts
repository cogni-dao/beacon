// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/growth/campaigns`
 * Purpose: Campaign collection surface — the growth-loop PLAN beat.
 *   `POST` files a falsifiable campaign hypothesis in the EDO substrate
 *   (domain `beacon-campaigns`, strategy `metric:engagement:<x>`) — the KPI resolver
 *   reads it — AND inserts the account-scoped `campaigns` RECORD (the owned, CRUD-able
 *   row with a real lifecycle `status`), self-healing the beacon-growth knowledge
 *   domains first so a fresh env doesn't 500. `GET` lists the
 *   `campaigns` rows (RLS-scoped to the user's account, NOT shared Doltgres) joined
 *   with their CURRENT engagement KPI (computed independently from `post_metrics`).
 *   (v0 campaign = a record; content generation + scheduling is a separate pipeline —
 *   no Temporal in the campaign path. See docs/spec/beacon-growth-loop-v0.md.)
 * Scope: HTTP boundary + Zod validation + orchestration. Files the EDO hypothesis
 *   (resolver dependency) + writes the owned record. The
 *   KPI is the same pure `computeEngagementKpi` the resolver bridge uses.
 * Invariants:
 *   - AUTH_VIA_SESSION: session-cookie required (humans trusted in v0, mirrors
 *     the session path of `POST /api/v1/edo/hypothesize`).
 *   - CAMPAIGN_RECORD_OWNED: the `campaigns` row is the account-private record;
 *     the EDO hypothesis stays the resolver's falsifiable claim. `campaign_id` joins them.
 *   - IDEMPOTENT_ON_CAMPAIGN_ID: re-POSTing the same slug is a no-op (409), never a dup row.
 *   - METRIC_STRATEGY: every campaign hypothesis opts into
 *     `resolution_strategy = 'metric:engagement:<campaignId>'`.
 *   - RLS_SCOPED_READS: the LIST reads `campaigns` inside `withTenantScope` (the GUC
 *     filters rows to the user's account) — never service-role.
 *   - KPI_NEVER_SELF_CITED: the listed KPI derives solely from `post_metrics`.
 * Side-effects: IO (HTTP, Doltgres write via edoCapability, Postgres read+write).
 * Links: docs/spec/beacon-growth-loop-v0.md §1/§6, .context/specs/pr3-verifier.md
 * @public
 */

import {
  computeEngagementKpi,
  type EngagementBasis,
  type PostMetricSnapshot,
} from "@cogni/knowledge-store";
import { withTenantScope } from "@cogni/db-client";
import { toUserId, type UserId, userActor } from "@cogni/ids";
import { and, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer, resolveAppDb } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { campaigns, postMetrics, posts } from "@/shared/db/schema";
import type { RequestContext } from "@/shared/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DOMAIN_CAMPAIGNS = "beacon-campaigns";
const DOMAIN_POST_PERFORMANCE = "beacon-post-performance";
const DOMAIN_BRAND_VOICE = "beacon-brand-voice";
const METRIC_ENGAGEMENT_PREFIX = "metric:engagement:";
const CAMPAIGN_HYPOTHESIS_CONFIDENCE = 30;
/** Slug-safe campaign id charset. */
const CAMPAIGN_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

// ---------------------------------------------------------------------------
// Wire contracts (Zod boundaries)
// ---------------------------------------------------------------------------

/** Default predicted engagement rate when the user doesn't set one (they shouldn't). */
const DEFAULT_TARGET_RATE = 0.02;
/** Default hypothesis-resolution horizon: 30 days out. */
const DEFAULT_EVALUATE_DAYS = 30;

const CreateCampaignInputSchema = z.object({
  /** Slug — auto-derived from the title in the UI; never shown to the user. */
  campaignId: z
    .string()
    .regex(CAMPAIGN_ID_RE, "campaignId must be a lowercase slug (a-z0-9-)"),
  title: z.string().min(1).max(200),
  // --- DEFINE: the campaign's durable DNA, injected into every AI prompt ---
  /** Core subject the campaign orbits. */
  coreTopic: z.string().min(1).max(500).optional(),
  /** Brand voice / tone the AI must write in. */
  voice: z.string().min(1).max(1000).optional(),
  /** Ideal-customer profile — who, specifically, this talks to. */
  icp: z.string().min(1).max(1000).optional(),
  /** What the campaign is trying to get the audience to do. */
  objective: z.string().min(1).max(1000).optional(),
  // --- EDO/KPI mechanics: defaulted server-side, NOT collected from the user ---
  /** Legacy free-text brief; composed from the DNA fields when absent. */
  brief: z.string().min(1).max(4000).optional(),
  /** Predicted engagement RATE; defaulted — not a user input. */
  targetRate: z.number().positive().max(1).optional(),
  /** Hypothesis-resolution deadline; defaulted — not a user input. */
  evaluateAt: z.string().datetime().optional(),
});

const CampaignKpiSchema = z.object({
  score0to100: z.number(),
  edge: z.enum(["validates", "invalidates"]),
  observedRate: z.number(),
  basis: z.enum(["impressions", "followers", "none"]),
  snapshotCount: z.number().int().nonnegative(),
  postedBroadcasts: z.number().int().nonnegative(),
});

/** Lifecycle status of the owned campaign record (mirrors the CHECK constraint). */
const CampaignStatusSchema = z.enum(["draft", "active", "paused", "done"]);
export type CampaignStatus = z.infer<typeof CampaignStatusSchema>;

const CampaignSummarySchema = z.object({
  campaignId: z.string(),
  title: z.string(),
  /** Owned lifecycle status from the `campaigns` table (not derived). */
  status: CampaignStatusSchema,
  brief: z.string().nullable(),
  targetRate: z.number().nullable(),
  evaluateAt: z.string().nullable(),
  createdAt: z.string(),
  kpi: CampaignKpiSchema,
});

const CampaignsListOutputSchema = z.object({
  campaigns: z.array(CampaignSummarySchema),
});

export type CampaignSummary = z.infer<typeof CampaignSummarySchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Load every cached `post_metrics` snapshot for one campaign's posted
 * `posts`. RLS_SCOPED_READS: runs inside `withTenantScope` under the session
 * user's GUC so the policy filters rows to the user's account(s) — never
 * service-role (which would bypass RLS and leak across accounts). Identical
 * reduction to the resolver bridge so the lens KPI matches the resolution KPI.
 */
async function loadCampaignSnapshots(
  campaignId: string,
  userId: string
): Promise<{
  snapshots: PostMetricSnapshot[];
  postedBroadcasts: number;
}> {
  const db = resolveAppDb();
  const actorId = userActor(userId as UserId);

  return withTenantScope(db, actorId, async (tx) => {
    const postRows = await tx
      .select({ id: posts.id })
      .from(posts)
      .where(
        and(eq(posts.campaignId, campaignId), eq(posts.status, "posted"))
      );
    const postIds = postRows.map((r) => r.id);
    if (postIds.length === 0) {
      return { snapshots: [], postedBroadcasts: 0 };
    }

    const rows = await tx
      .select({
        impressions: postMetrics.impressions,
        likes: postMetrics.likes,
        reposts: postMetrics.reposts,
        replies: postMetrics.replies,
        followersAtCapture: postMetrics.followersAtCapture,
      })
      .from(postMetrics)
      .where(inArray(postMetrics.postId, postIds));

    const snapshots: PostMetricSnapshot[] = rows.map((r) => ({
      impressions: r.impressions ?? null,
      likes: r.likes ?? 0,
      reposts: r.reposts ?? 0,
      replies: r.replies ?? 0,
      followersAtCapture: r.followersAtCapture ?? null,
    }));
    return { snapshots, postedBroadcasts: postIds.length };
  });
}

type AppContainer = ReturnType<typeof getContainer>;
type KnowledgeStorePort = NonNullable<AppContainer["knowledgeStorePort"]>;

/** Register one knowledge domain if absent; tolerate the already-registered race. */
async function ensureDomain(
  ctx: RequestContext,
  store: KnowledgeStorePort,
  input: { id: string; name: string; description: string }
): Promise<void> {
  if (await store.domainExists(input.id)) {
    return;
  }
  try {
    await store.registerDomain(input);
    ctx.log.info(
      { route: "growth.campaigns.create", domain: input.id },
      "growth.knowledge_domain.registered"
    );
  } catch (error) {
    if (error instanceof Error && error.name === "DomainAlreadyRegisteredError") {
      return;
    }
    throw error;
  }
}

/**
 * Self-heal: register the 3 beacon-growth knowledge domains before the campaign
 * hypothesis is filed. `BASE_DOMAIN_SEEDS` only seed at DB-init, so a fresh
 * preview/candidate env has no domains and `edo.hypothesize` 500s with
 * `DomainNotRegisteredError`. Idempotent (domainExists guard + race tolerance).
 */
async function ensureGrowthKnowledgeDomains(
  ctx: RequestContext,
  container: AppContainer
): Promise<void> {
  const store = container.knowledgeStorePort;
  if (!store) {
    return;
  }
  await ensureDomain(ctx, store, {
    id: DOMAIN_CAMPAIGNS,
    name: "Beacon Campaigns",
    description:
      "Growth-campaign hypotheses (metric:engagement) and resolved outcomes for the beacon growth loop.",
  });
  await ensureDomain(ctx, store, {
    id: DOMAIN_POST_PERFORMANCE,
    name: "Beacon Post Performance",
    description:
      "Per-post and per-angle findings that cite campaign hypotheses as evidence.",
  });
  await ensureDomain(ctx, store, {
    id: DOMAIN_BRAND_VOICE,
    name: "Beacon Brand Voice",
    description:
      "Durable growth learnings: winning hooks, angles, formats, timing, and channel patterns.",
  });
}

// ---------------------------------------------------------------------------
// POST /api/v1/growth/campaigns — PLAN: file the campaign record + hypothesis
// (v0 = record only; content generation/scheduling is a separate pipeline)
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

    // Self-heal the knowledge domains so a fresh env doesn't 500 on hypothesize.
    await ensureGrowthKnowledgeDomains(ctx, container);

    const hypothesisId = `campaign:${input.campaignId}`;
    const resolutionStrategy = `${METRIC_ENGAGEMENT_PREFIX}${input.campaignId}`;

    // EDO/KPI mechanics are DEFAULTED — the user never sets them.
    const targetRate = input.targetRate ?? DEFAULT_TARGET_RATE;
    const evaluateAt = input.evaluateAt
      ? new Date(input.evaluateAt)
      : new Date(Date.now() + DEFAULT_EVALUATE_DAYS * 24 * 60 * 60 * 1000);

    // The brief stored on the record is composed from the DEFINE DNA when the
    // caller didn't pass a free-text brief — so the detail page + downstream
    // grounding always have a human-readable summary.
    const brief =
      input.brief?.trim() ||
      [
        input.objective && `Objective: ${input.objective.trim()}`,
        input.icp && `Audience: ${input.icp.trim()}`,
        input.coreTopic && `Topic: ${input.coreTopic.trim()}`,
        input.voice && `Voice: ${input.voice.trim()}`,
      ]
        .filter(Boolean)
        .join("\n") ||
      input.title;

    // The hypothesis content is the durable home for the predicted rate; the
    // resolver parses `target_rate` from it.
    const content = [
      brief,
      "",
      `target_rate=${targetRate}`,
      `Recall beacon-brand-voice for winning angles/hooks/formats before producing.`,
    ].join("\n");

    // Resolve the owning billing account up front — both the owned `campaigns`
    // record and the content schedule are stamped with it (tenancy axis).
    const accountService = container.accountsForUser(toUserId(sessionUser.id));
    const account = await accountService.getOrCreateBillingAccountForUser({
      userId: sessionUser.id,
    });

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

      // Persist the account-owned campaign RECORD. IDEMPOTENT_ON_CAMPAIGN_ID:
      // the (account_id, campaign_id) unique index rejects a duplicate slug
      // (caught below → 409). RLS_SCOPED_WRITE: insert under the user's GUC so
      // the WITH CHECK predicate authorizes the row to the user's account.
      const db = resolveAppDb();
      const actorId = userActor(sessionUser.id as UserId);
      await withTenantScope(db, actorId, async (tx) => {
        await tx.insert(campaigns).values({
          accountId: account.id,
          campaignId: input.campaignId,
          title: input.title,
          brief,
          // DEFINE DNA — what the AI reads on every research/generate run.
          coreTopic: input.coreTopic ?? null,
          voice: input.voice ?? null,
          icp: input.icp ?? null,
          objective: input.objective ?? null,
          targetRate,
          status: "draft",
          evaluateAt,
        });
      });

      ctx.log.info(
        {
          route: "growth.campaigns.create",
          campaignId: input.campaignId,
          hypothesisId,
          resolutionStrategy,
        },
        "growth.campaign.created"
      );

      return NextResponse.json(
        {
          campaignId: input.campaignId,
          hypothesisId: hypothesis.id,
          resolutionStrategy,
          status: "draft",
          evaluateAt: evaluateAt.toISOString(),
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

    const DEFAULT_TARGET_RATE = 0.02;
    const db = resolveAppDb();
    const actorId = userActor(sessionUser.id as UserId);

    // RLS_SCOPED_READS: the campaign list is the owned `campaigns` table filtered
    // to the session user's account(s) by the policy GUC — NOT shared Doltgres.
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
        .orderBy(desc(campaigns.createdAt))
    );

    const out: CampaignSummary[] = [];
    for (const r of rows) {
      const { snapshots, postedBroadcasts } = await loadCampaignSnapshots(
        r.campaignId,
        sessionUser.id
      );
      const kpi = computeEngagementKpi(snapshots, {
        rate: r.targetRate ?? DEFAULT_TARGET_RATE,
      });
      const basis: EngagementBasis = kpi.basis;

      out.push({
        campaignId: r.campaignId,
        title: r.title,
        status: CampaignStatusSchema.parse(r.status),
        brief: r.brief ?? null,
        targetRate: r.targetRate ?? null,
        evaluateAt: r.evaluateAt ? r.evaluateAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
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
      { route: "growth.campaigns.list", count: out.length },
      "growth.campaigns.list_success"
    );

    return NextResponse.json(
      CampaignsListOutputSchema.parse({ campaigns: out }),
      { status: 200 }
    );
  }
);
