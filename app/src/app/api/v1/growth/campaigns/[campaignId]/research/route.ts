// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/growth/campaigns/[campaignId]/research`
 * Purpose: The RESEARCH activity of the beacon growth loop, exposed on-demand (v0).
 *   `POST` loads the campaign's strategy (voice/core_topic/icp/objective), recalls
 *   generic brand-voice playbook from the Dolt knowledge hub, loads cached tenant
 *   social evidence (connected-account snapshots + owned post metrics), runs the
 *   one-pass research workflow via the LLM, and PERSISTS the resulting tenant
 *   `findings` (insight/pain_point/angle plus source-backed exemplar/reference)
 *   account-scoped — then returns them.
 * Scope: HTTP boundary + auth + orchestration. The thinking lives in the pure
 *   `runGrowthResearch` workflow (`@cogni/langgraph-graphs`); this route wires the
 *   real LLM + knowledge recall + RLS-scoped persistence. No Temporal (v0 thin,
 *   on-demand — the loop's cron driver lands with the heartbeat PR).
 * Invariants:
 *   - AUTH_VIA_SESSION: session-cookie required (mirrors the campaigns routes).
 *   - RLS_SCOPED_READS_WRITES: the campaign read AND the findings insert run inside
 *     `withTenantScope` under the session user's GUC — never service-role.
 *   - FINDINGS_ARE_TENANT_DATA: findings are written to Postgres only, NEVER Doltgres.
 *   - RESEARCH_IS_AN_ACTIVITY: there is no `research` table; this route runs the
 *     activity and its outputs land in `findings`.
 *   - PLAYBOOK_RECALL_FAIL_OPEN: a missing/empty knowledge hub degrades to no
 *     playbook (the workflow still produces findings).
 *   - SOCIAL_EVIDENCE_IS_CACHED: this route reads only Postgres-cached connection
 *     snapshots and post_metrics; it never calls a paid/passive platform API.
 * Side-effects: IO (HTTP, LLM completion, Doltgres read, Postgres read+write).
 * Links: ../route.ts, docs/spec/beacon-growth-loop-v0.md §2.2/§3/§7,
 *   packages/langgraph-graphs/src/graphs/growth-research/workflow.ts
 * @public
 */

import { randomUUID } from "node:crypto";
import { withTenantScope } from "@cogni/db-client";
import { connections } from "@cogni/db-schema";
import { toUserId, type UserId, userActor } from "@cogni/ids";
import {
  type CampaignStrategy,
  type JsonObject,
  type ResearchFinding,
  type TenantSocialContext,
  runGrowthResearch,
} from "@cogni/langgraph-graphs";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { chatCompletion } from "@/app/_facades/ai/completion.server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer, resolveAppDb } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import {
  campaignCurrentState,
  campaignIntelligenceRuns,
  campaignPostPriorities,
  campaigns,
  findings,
  postMetrics,
  posts,
} from "@/shared/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Generic brand-voice playbook domain recalled to ground the research activity. */
const DOMAIN_BRAND_VOICE = "beacon-brand-voice";
/** Default model for the v0 research pass (cheap; the synthesis is small). */
const RESEARCH_MODEL = "gpt-4o-mini";
/** How many playbook notes to recall from the Dolt hub. */
const PLAYBOOK_RECALL_LIMIT = 5;
/** Defensive context caps: research should be grounded, not overloaded. */
const PRIOR_FINDINGS_LIMIT = 12;
const OWNED_POSTS_LIMIT = 12;
const CONNECTIONS_LIMIT = 8;
const SOURCE_BACKED_POST_FINDINGS_LIMIT = 3;
const SOURCE_BACKED_CONNECTION_FINDINGS_LIMIT = 3;

type SourceBackedKind = "exemplar" | "reference";
type PersistableFinding = {
  kind: ResearchFinding["kind"] | SourceBackedKind;
  content: string;
  sourceRef?: string | null;
  metadata?: JsonObject | null;
};

type PersistedFinding = {
  id: string;
  kind: string;
  content: string;
  sourceRef: string | null;
  metadata: JsonObject | null;
  createdAt: Date;
};

type NextPostPriority = {
  rank: number;
  score: number;
  funnelLayer: "tofu" | "mofu" | "bofu";
  topic: string | null;
  angle: string | null;
  premise: string;
  justification: string;
  kpiMetric: string;
  metadata: JsonObject;
};

interface PriorFinding {
  kind: string;
  content: string;
  sourceRef: string | null;
  metadata: JsonObject | null;
}

interface OwnedPostEvidence {
  id: string;
  channel: string;
  funnelLayer: string;
  topic: string | null;
  angle: string | null;
  text: string;
  status: string;
  externalPostId: string | null;
  postedAt: Date | null;
  createdAt: Date;
  latestMetrics: {
    capturedAt: Date;
    impressions: number | null;
    likes: number;
    reposts: number;
    replies: number;
    followersAtCapture: number | null;
  } | null;
}

interface ConnectionEvidence {
  id: string;
  provider: string;
  externalHandle: string | null;
  displayLabel: string | null;
  status: string;
  metricsSnapshot: unknown;
  metricsFetchedAt: Date | null;
}

interface TenantEvidence {
  priorFindings: PriorFinding[];
  ownedPosts: OwnedPostEvidence[];
  connections: ConnectionEvidence[];
}

function truncateText(value: string, max = 260): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function formatDate(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : "unknown date";
}

function summarizeSnapshot(snapshot: unknown): string {
  if (snapshot === null || snapshot === undefined) return "no cached snapshot";
  if (typeof snapshot === "string") return truncateText(snapshot, 220);
  if (typeof snapshot === "number" || typeof snapshot === "boolean") {
    return String(snapshot);
  }
  try {
    return truncateText(JSON.stringify(snapshot), 280);
  } catch {
    return "cached snapshot available";
  }
}

function toJsonObject(value: unknown): JsonObject | null {
  if (value === null || value === undefined) return null;
  try {
    const parsed = JSON.parse(JSON.stringify(value)) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as JsonObject;
    }
    return { value: parsed as JsonObject[string] };
  } catch {
    return null;
  }
}

function stringFromMeta(
  metadata: JsonObject | null | undefined,
  key: string
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function numberFromMeta(
  metadata: JsonObject | null | undefined,
  key: string
): number | null {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function arrayFromMeta(
  metadata: JsonObject | null | undefined,
  key: string
): string[] {
  const value = metadata?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function asFunnelLayer(value: string | null): "tofu" | "mofu" | "bofu" | null {
  return value === "tofu" || value === "mofu" || value === "bofu"
    ? value
    : null;
}

function inferFunnelLayer(finding: PersistedFinding): "tofu" | "mofu" | "bofu" {
  const explicit = asFunnelLayer(stringFromMeta(finding.metadata, "funnelLayer"));
  if (explicit) return explicit;
  if (finding.kind === "pain_point") return "mofu";
  if (finding.kind === "insight") return "mofu";
  return "tofu";
}

function extractKpiMetric(metadata: JsonObject | null): string {
  const direct = stringFromMeta(metadata, "kpiMetric");
  if (direct) return direct;
  const hypothesis = metadata?.kpiHypothesis;
  if (
    hypothesis &&
    typeof hypothesis === "object" &&
    !Array.isArray(hypothesis)
  ) {
    const metric = (hypothesis as Record<string, unknown>).metric;
    if (typeof metric === "string" && metric.trim().length > 0) {
      return metric.trim();
    }
  }
  if (typeof hypothesis === "string" && hypothesis.trim().length > 0) {
    return hypothesis.trim();
  }
  return "qualified_engagement_rate";
}

function sourceRefsForFinding(finding: PersistedFinding): string[] {
  const refs = new Set<string>();
  if (finding.sourceRef) refs.add(finding.sourceRef);
  for (const key of ["basis", "evidenceBasis", "sourceRefs"]) {
    for (const ref of arrayFromMeta(finding.metadata, key)) refs.add(ref);
  }
  return [...refs];
}

function metadataConfidence(finding: PersistedFinding): number | null {
  return (
    numberFromMeta(finding.metadata, "confidence") ??
    numberFromMeta(finding.metadata, "scoreHint") ??
    numberFromMeta(finding.metadata, "score")
  );
}

function baseFindingScore(kind: string): number {
  switch (kind) {
    case "angle":
      return 0.62;
    case "insight":
      return 0.56;
    case "pain_point":
      return 0.54;
    case "exemplar":
      return 0.46;
    case "reference":
      return 0.38;
    default:
      return 0.3;
  }
}

function scoreFindingForNextPost(finding: PersistedFinding): number {
  const sourceRefs = sourceRefsForFinding(finding);
  const confidence = metadataConfidence(finding);
  const sourceBoost = sourceRefs.length > 0 ? 0.12 : 0;
  const nextActionBoost = stringFromMeta(finding.metadata, "nextAction")
    ? 0.08
    : 0;
  const kpiBoost =
    extractKpiMetric(finding.metadata) !== "qualified_engagement_rate"
      ? 0.05
      : 0;
  const confidenceBoost =
    confidence === null ? 0 : (clamp01(confidence) - 0.5) * 0.18;
  return clamp01(
    baseFindingScore(finding.kind) +
      sourceBoost +
      nextActionBoost +
      kpiBoost +
      confidenceBoost
  );
}

function buildPostPriorities(findings: PersistedFinding[]): NextPostPriority[] {
  const actionable = findings
    .filter(
      (f) =>
        f.kind === "angle" ||
        f.kind === "insight" ||
        f.kind === "pain_point"
    )
    .map((finding) => {
      const score = scoreFindingForNextPost(finding);
      const sourceRefs = sourceRefsForFinding(finding);
      const funnelLayer = inferFunnelLayer(finding);
      const topic = stringFromMeta(finding.metadata, "topic");
      const angle =
        stringFromMeta(finding.metadata, "angle") ??
        (finding.kind === "angle" ? truncateText(finding.content, 90) : null);
      const kpiMetric = extractKpiMetric(finding.metadata);
      const confidence = metadataConfidence(finding);
      return {
        finding,
        priority: {
          rank: 0,
          score,
          funnelLayer,
          topic,
          angle,
          premise: finding.content,
          justification: [
            `${finding.kind} finding scored ${Math.round(score * 100)}/100`,
            sourceRefs.length > 0
              ? `${sourceRefs.length} evidence refs`
              : "synthesized finding",
            confidence !== null
              ? `model confidence ${Math.round(clamp01(confidence) * 100)}/100`
              : null,
            `KPI focus: ${kpiMetric}`,
          ]
            .filter((part): part is string => Boolean(part))
            .join("; "),
          kpiMetric,
          metadata: {
            findingId: finding.id,
            findingKind: finding.kind,
            evidenceBasis: sourceRefs,
            confidenceBasis: "deterministic_v0_source_kind_confidence_scorer",
            ...(finding.metadata?.kpiHypothesis
              ? { kpiHypothesis: finding.metadata.kpiHypothesis }
              : {}),
          },
        },
      };
    })
    .sort((a, b) => b.priority.score - a.priority.score)
    .slice(0, 5);

  return actionable.map((item, i) => ({
    ...item.priority,
    rank: i + 1,
  }));
}

function strongestNextAction(findings: PersistedFinding[]): string | null {
  for (const finding of findings) {
    const action =
      stringFromMeta(finding.metadata, "nextAction") ??
      stringFromMeta(finding.metadata, "recommendedNextAction");
    if (action) return action;
  }
  return null;
}

function buildCurrentState(params: {
  findings: PersistedFinding[];
  priorities: NextPostPriority[];
}): {
  summary: string;
  nextAction: string;
  confidence: number;
  metadata: JsonObject;
} {
  const { findings, priorities } = params;
  const topPriority = priorities[0];
  const topFinding = findings.find((f) => f.kind === "insight") ?? findings[0];
  const refs = new Set<string>();
  for (const finding of findings) {
    for (const ref of sourceRefsForFinding(finding)) refs.add(ref);
  }
  const nextAction =
    strongestNextAction(findings) ??
    (topPriority
      ? [
          `Generate the rank ${topPriority.rank}`,
          `${topPriority.funnelLayer.toUpperCase()} post`,
          `and keep it tied to ${topPriority.kpiMetric}.`,
        ].join(" ")
      : "Refresh intelligence with more evidence before generating posts.");
  const summary = topPriority
    ? `Best next post: ${truncateText(topPriority.premise, 180)}`
    : topFinding
      ? truncateText(topFinding.content, 180)
      : "No actionable campaign thinking yet.";
  const confidence =
    topPriority?.score ??
    (topFinding ? scoreFindingForNextPost(topFinding) : 0.3);
  return {
    summary,
    nextAction,
    confidence,
    metadata: {
      sourceRefs: [...refs].slice(0, 12),
      nextPostCount: priorities.length,
      kpiMetric: topPriority?.kpiMetric ?? "qualified_engagement_rate",
      kpiRationale: [
        "v0 deterministic scorer prioritizes source-backed, actionable findings",
        "with funnel/KPI hints.",
      ].join(" "),
    },
  };
}

function sourceCountsFor(
  evidence: TenantEvidence,
  sourceBackedCount: number
): JsonObject {
  return {
    connections: evidence.connections.length,
    ownedPosts: evidence.ownedPosts.length,
    priorFindings: evidence.priorFindings.length,
    sourceBackedFindings: sourceBackedCount,
  };
}

function postMetricSummary(
  metrics: OwnedPostEvidence["latestMetrics"]
): string {
  if (!metrics) return "no cached metrics";
  const engagement = metrics.likes + metrics.reposts + metrics.replies;
  const parts = [
    `${engagement} engagements`,
    `${metrics.likes} likes`,
    `${metrics.reposts} reposts`,
    `${metrics.replies} replies`,
  ];
  if (typeof metrics.impressions === "number") {
    parts.unshift(`${metrics.impressions} impressions`);
  }
  if (typeof metrics.followersAtCapture === "number") {
    parts.push(`${metrics.followersAtCapture} followers at capture`);
  }
  parts.push(`captured ${formatDate(metrics.capturedAt)}`);
  return parts.join(", ");
}

function accountLabel(c: ConnectionEvidence): string {
  return c.displayLabel || c.externalHandle || c.provider;
}

function postEvidenceScore(p: OwnedPostEvidence): number {
  const m = p.latestMetrics;
  if (!m) return 0;
  return (m.impressions ?? 0) + (m.likes + m.reposts + m.replies) * 100;
}

function buildSourceBackedFindings(
  evidence: TenantEvidence
): Array<{
  kind: SourceBackedKind;
  content: string;
  sourceRef: string;
  metadata: JsonObject;
}> {
  const emittedRefs = new Set<string>();
  const out: Array<{
    kind: SourceBackedKind;
    content: string;
    sourceRef: string;
    metadata: JsonObject;
  }> = [];

  for (const c of evidence.connections
    .filter(
      (row) => row.metricsSnapshot !== null && row.metricsSnapshot !== undefined
    )
    .slice(0, SOURCE_BACKED_CONNECTION_FINDINGS_LIMIT)) {
    const sourceRef = `connection:${c.id}`;
    if (emittedRefs.has(sourceRef)) continue;
    emittedRefs.add(sourceRef);
    out.push({
      kind: "reference",
      sourceRef,
      content: [
        `Cached ${c.provider} snapshot for ${accountLabel(c)}`,
        `(${c.status}, fetched ${formatDate(c.metricsFetchedAt)}):`,
        summarizeSnapshot(c.metricsSnapshot),
      ].join(" "),
      metadata: {
        sourceType: "connected_account",
        platform: c.provider,
        sourceAccountRef: c.externalHandle ?? c.displayLabel ?? c.id,
        evidenceBasis: ["cached_connection_metrics_snapshot"],
      },
    });
  }

  const rankedPosts = evidence.ownedPosts
    .filter((p) => p.latestMetrics || p.externalPostId || p.status === "posted")
    .sort((a, b) => postEvidenceScore(b) - postEvidenceScore(a))
    .slice(0, SOURCE_BACKED_POST_FINDINGS_LIMIT);
  for (const p of rankedPosts) {
    const sourceRef = `post:${p.id}`;
    if (emittedRefs.has(sourceRef)) continue;
    emittedRefs.add(sourceRef);
    const metadata: JsonObject = {
      sourceType: "owned_post",
      platform: p.channel,
      sourcePostRef: p.externalPostId ?? p.id,
      funnelLayer: p.funnelLayer,
      evidenceBasis: [
        "owned_post_history",
        p.latestMetrics ? "cached_post_metrics" : "post_record",
      ],
    };
    if (p.topic) metadata.topic = p.topic;
    if (p.angle) metadata.angle = p.angle;
    out.push({
      kind: "exemplar",
      sourceRef,
      content: `Owned ${p.channel}/${p.funnelLayer} post (${p.status}, ${postMetricSummary(
        p.latestMetrics
      )}): "${truncateText(p.text, 220)}"`,
      metadata,
    });
  }

  return out;
}

function toTenantSocialContext(evidence: TenantEvidence): TenantSocialContext {
  return {
    connectedAccounts: evidence.connections
      .filter((c) => c.metricsSnapshot !== null && c.metricsSnapshot !== undefined)
      .map((c) => ({
        sourceRef: `connection:${c.id}`,
        platform: c.provider,
        handle: c.externalHandle,
        displayName: c.displayLabel,
        metricsSnapshot: toJsonObject(c.metricsSnapshot),
        capturedAt: c.metricsFetchedAt?.toISOString() ?? null,
      })),
    recentPosts: evidence.ownedPosts.map((p) => ({
      sourceRef: `post:${p.id}`,
      platform: p.channel,
      postId: p.externalPostId ?? p.id,
      text: p.text,
      publishedAt: p.postedAt?.toISOString() ?? p.createdAt.toISOString(),
      funnelLayer: p.funnelLayer,
      metrics: p.latestMetrics
        ? {
            capturedAt: p.latestMetrics.capturedAt.toISOString(),
            impressions: p.latestMetrics.impressions,
            likes: p.latestMetrics.likes,
            reposts: p.latestMetrics.reposts,
            replies: p.latestMetrics.replies,
            followersAtCapture: p.latestMetrics.followersAtCapture,
          }
        : null,
    })),
    existingFindings: evidence.priorFindings.map((f, i) => ({
      sourceRef: f.sourceRef ?? `finding:${i}`,
      kind: f.kind,
      content: f.content,
    })),
  };
}

async function loadTenantEvidence(params: {
  db: ReturnType<typeof resolveAppDb>;
  actorId: ReturnType<typeof userActor>;
  accountId: string;
  campaignId: string;
}): Promise<TenantEvidence> {
  const { db, actorId, accountId, campaignId } = params;
  return withTenantScope(db, actorId, async (tx) => {
    const priorFindingRows = await tx
      .select({
        kind: findings.kind,
        content: findings.content,
        sourceRef: findings.sourceRef,
        metadata: findings.metadata,
      })
      .from(findings)
      .where(eq(findings.campaignId, campaignId))
      .orderBy(desc(findings.createdAt))
      .limit(PRIOR_FINDINGS_LIMIT);
    const priorFindings: PriorFinding[] = priorFindingRows.map((f) => ({
      ...f,
      metadata: toJsonObject(f.metadata),
    }));

    const postRows = await tx
      .select({
        id: posts.id,
        channel: posts.channel,
        funnelLayer: posts.funnelLayer,
        topic: posts.topic,
        angle: posts.angle,
        text: posts.text,
        status: posts.status,
        externalPostId: posts.externalPostId,
        postedAt: posts.postedAt,
        createdAt: posts.createdAt,
      })
      .from(posts)
      .where(eq(posts.campaignId, campaignId))
      .orderBy(desc(posts.createdAt))
      .limit(OWNED_POSTS_LIMIT);

    const latestMetricsByPost = new Map<
      string,
      OwnedPostEvidence["latestMetrics"]
    >();
    if (postRows.length > 0) {
      const metricRows = await tx
        .select({
          postId: postMetrics.postId,
          capturedAt: postMetrics.capturedAt,
          impressions: postMetrics.impressions,
          likes: postMetrics.likes,
          reposts: postMetrics.reposts,
          replies: postMetrics.replies,
          followersAtCapture: postMetrics.followersAtCapture,
        })
        .from(postMetrics)
        .where(inArray(postMetrics.postId, postRows.map((p) => p.id)));

      for (const m of metricRows) {
        const current = latestMetricsByPost.get(m.postId);
        if (!current || m.capturedAt.getTime() > current.capturedAt.getTime()) {
          latestMetricsByPost.set(m.postId, {
            capturedAt: m.capturedAt,
            impressions: m.impressions ?? null,
            likes: m.likes ?? 0,
            reposts: m.reposts ?? 0,
            replies: m.replies ?? 0,
            followersAtCapture: m.followersAtCapture ?? null,
          });
        }
      }
    }

    const connectionRows = await tx
      .select({
        id: connections.id,
        provider: connections.provider,
        externalHandle: connections.externalHandle,
        displayLabel: connections.displayLabel,
        status: connections.status,
        metricsSnapshot: connections.metricsSnapshot,
        metricsFetchedAt: connections.metricsFetchedAt,
      })
      .from(connections)
      .where(
        and(
          eq(connections.billingAccountId, accountId),
          isNull(connections.revokedAt)
        )
      )
      .orderBy(desc(connections.createdAt))
      .limit(CONNECTIONS_LIMIT);

    return {
      priorFindings,
      ownedPosts: postRows.map((p) => ({
        ...p,
        latestMetrics: latestMetricsByPost.get(p.id) ?? null,
      })),
      connections: connectionRows,
    };
  });
}

// ---------------------------------------------------------------------------
// POST /api/v1/growth/campaigns/[campaignId]/research — run the activity
// ---------------------------------------------------------------------------

export const POST = wrapRouteHandlerWithLogging<{
  params: Promise<{ campaignId: string }>;
}>(
  {
    routeId: "growth.campaigns.research",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx, _request, sessionUser, context) => {
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (!context) {
      return NextResponse.json(
        { error: "missing route context" },
        { status: 400 }
      );
    }
    const { campaignId } = await context.params;
    const slug = decodeURIComponent(campaignId);

    const db = resolveAppDb();
    const actorId = userActor(sessionUser.id as UserId);

    // RLS_SCOPED_READS: load the campaign strategy under the user's GUC; a
    // non-owner sees the row filtered out → zero rows → 404 (no existence leak).
    const campaignRow = await withTenantScope(db, actorId, async (tx) => {
      const rows = await tx
        .select({
          campaignId: campaigns.campaignId,
          brief: campaigns.brief,
          voice: campaigns.voice,
          coreTopic: campaigns.coreTopic,
          icp: campaigns.icp,
          objective: campaigns.objective,
        })
        .from(campaigns)
        .where(eq(campaigns.campaignId, slug))
        .limit(1);
      return rows[0];
    });

    if (!campaignRow) {
      return NextResponse.json(
        { error: "campaign not found" },
        { status: 404 }
      );
    }

    const container = getContainer();

    // Resolve the owning billing account (tenancy axis for the persisted rows;
    // the LLM billing caller is resolved from the session inside the facade).
    const accountService = container.accountsForUser(toUserId(sessionUser.id));
    const account = await accountService.getOrCreateBillingAccountForUser({
      userId: sessionUser.id,
    });

    const strategy: CampaignStrategy = {
      campaignId: campaignRow.campaignId,
      brief: campaignRow.brief,
      voice: campaignRow.voice,
      coreTopic: campaignRow.coreTopic,
      icp: campaignRow.icp,
      objective: campaignRow.objective,
    };
    const tenantEvidence = await loadTenantEvidence({
      db,
      actorId,
      accountId: account.id,
      campaignId: slug,
    });
    const socialContext = toTenantSocialContext(tenantEvidence);
    const run = await withTenantScope(db, actorId, async (tx) => {
      const rows = await tx
        .insert(campaignIntelligenceRuns)
        .values({
          id: randomUUID(),
          accountId: account.id,
          campaignId: slug,
          status: "running",
          trigger: "manual_refresh",
          modelRef: RESEARCH_MODEL,
          sourceCounts: sourceCountsFor(tenantEvidence, 0),
        })
        .returning({ id: campaignIntelligenceRuns.id });
      return rows[0];
    });

    if (!run) {
      return NextResponse.json(
        { error: "failed to start intelligence run" },
        { status: 500 }
      );
    }

    // Inject the real LLM through the BILLABLE_AI_THROUGH_EXECUTOR path: the
    // chatCompletion facade routes through GraphRunWorkflow → GraphExecutorPort,
    // so the preflight credit gate + usage-commit decorators run (bug.5042 — the
    // old direct non-streaming LlmService seam silently post-billed with no
    // credit check). Billing account is resolved from the session in the facade.
    const complete = async (input: {
      system: string;
      user: string;
    }): Promise<string> => {
      const result = await chatCompletion(
        {
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.user },
          ],
          modelRef: { providerKey: "platform", modelId: RESEARCH_MODEL },
          sessionUser,
        },
        ctx
      );
      const content = result.choices[0]?.message.content;
      return typeof content === "string" ? content : "";
    };

    // Inject Dolt recall (PLAYBOOK_RECALL_FAIL_OPEN handled inside the workflow):
    // generic brand-voice/playbook only — never tenant data.
    const store = container.knowledgeStorePort;
    const recallPlaybook = store
      ? async (query: string): Promise<string[]> => {
          const hits = await store.searchKnowledge(DOMAIN_BRAND_VOICE, query, {
            limit: PLAYBOOK_RECALL_LIMIT,
          });
          return hits.map((h) => `${h.title}: ${h.content}`.slice(0, 500));
        }
      : undefined;

    let produced: ResearchFinding[];
    try {
      produced = await runGrowthResearch({
        strategy,
        socialContext,
        complete,
        ...(recallPlaybook ? { recallPlaybook } : {}),
      });
    } catch (e) {
      await withTenantScope(db, actorId, async (tx) =>
        tx
          .update(campaignIntelligenceRuns)
          .set({
            status: "failed",
            completedAt: new Date(),
            errorCode: e instanceof Error ? e.message.slice(0, 120) : "research_error",
          })
          .where(eq(campaignIntelligenceRuns.id, run.id))
      );
      throw e;
    }

    if (produced.length === 0) {
      await withTenantScope(db, actorId, async (tx) =>
        tx
          .update(campaignIntelligenceRuns)
          .set({
            status: "failed",
            completedAt: new Date(),
            errorCode: "no_actionable_findings",
          })
          .where(eq(campaignIntelligenceRuns.id, run.id))
      );
      return NextResponse.json(
        { error: "research did not produce actionable findings" },
        { status: 502 }
      );
    }
    const sourceBacked = buildSourceBackedFindings(tenantEvidence);
    const findingsToPersist: PersistableFinding[] = [
      ...sourceBacked,
      ...produced,
    ];

    // RLS_SCOPED_WRITES + FINDINGS_ARE_TENANT_DATA: persist account-scoped to
    // Postgres under the user's GUC (the WITH CHECK authorizes the rows). Never Dolt.
    const { persisted, priorities, state } = await withTenantScope(
      db,
      actorId,
      async (tx) => {
        await tx
          .delete(campaignPostPriorities)
          .where(eq(campaignPostPriorities.campaignId, slug));
        await tx
          .delete(campaignCurrentState)
          .where(eq(campaignCurrentState.campaignId, slug));
        await tx.delete(findings).where(eq(findings.campaignId, slug));

        const persisted = await tx
          .insert(findings)
          .values(
            findingsToPersist.map((f) => ({
              id: randomUUID(),
              accountId: account.id,
              campaignId: slug,
              kind: f.kind,
              content: f.content,
              sourceRef: f.sourceRef ?? null,
              metadata: f.metadata ?? null,
            }))
          )
          .returning({
            id: findings.id,
            kind: findings.kind,
            content: findings.content,
            sourceRef: findings.sourceRef,
            metadata: findings.metadata,
            createdAt: findings.createdAt,
          });

        const prioritiesToPersist = buildPostPriorities(
          persisted.map((f) => ({
            ...f,
            metadata: toJsonObject(f.metadata),
          }))
        );
        const priorities =
          prioritiesToPersist.length > 0
            ? await tx
                .insert(campaignPostPriorities)
                .values(
                  prioritiesToPersist.map((p) => ({
                    id: randomUUID(),
                    accountId: account.id,
                    campaignId: slug,
                    runId: run.id,
                    rank: p.rank,
                    score: p.score,
                    status: "proposed",
                    funnelLayer: p.funnelLayer,
                    topic: p.topic,
                    angle: p.angle,
                    premise: p.premise,
                    justification: p.justification,
                    kpiMetric: p.kpiMetric,
                    metadata: p.metadata,
                  }))
                )
                .returning({
                  id: campaignPostPriorities.id,
                  rank: campaignPostPriorities.rank,
                  score: campaignPostPriorities.score,
                  funnelLayer: campaignPostPriorities.funnelLayer,
                  topic: campaignPostPriorities.topic,
                  angle: campaignPostPriorities.angle,
                  premise: campaignPostPriorities.premise,
                  justification: campaignPostPriorities.justification,
                  kpiMetric: campaignPostPriorities.kpiMetric,
                  metadata: campaignPostPriorities.metadata,
                })
            : [];

        const current = buildCurrentState({
          findings: persisted.map((f) => ({
            ...f,
            metadata: toJsonObject(f.metadata),
          })),
          priorities: prioritiesToPersist,
        });
        const stateMetadata = {
          ...current.metadata,
          nextPostPriorityIds: priorities.map((p) => p.id),
        };
        const states = await tx
          .insert(campaignCurrentState)
          .values({
            id: randomUUID(),
            accountId: account.id,
            campaignId: slug,
            runId: run.id,
            summary: current.summary,
            nextAction: current.nextAction,
            confidence: current.confidence,
            metadata: stateMetadata,
            updatedAt: new Date(),
          })
          .returning({
            id: campaignCurrentState.id,
            summary: campaignCurrentState.summary,
            nextAction: campaignCurrentState.nextAction,
            confidence: campaignCurrentState.confidence,
            metadata: campaignCurrentState.metadata,
            updatedAt: campaignCurrentState.updatedAt,
          });

        await tx
          .update(campaignIntelligenceRuns)
          .set({
            status: "completed",
            completedAt: new Date(),
            sourceCounts: sourceCountsFor(tenantEvidence, sourceBacked.length),
            findingCount: persisted.length,
            recommendationCount: priorities.length,
          })
          .where(eq(campaignIntelligenceRuns.id, run.id));

        return { persisted, priorities, state: states[0] };
      }
    );

    ctx.log.info(
      {
        route: "growth.campaigns.research",
        campaignId: slug,
        runId: run.id,
        findingsCount: persisted.length,
        sourceBackedCount: sourceBacked.length,
        priorityCount: priorities.length,
      },
      "growth.campaign.research_complete"
    );

    return NextResponse.json(
      {
        campaignId: slug,
        intelligenceRun: {
          id: run.id,
          status: "completed",
          modelRef: RESEARCH_MODEL,
        },
        currentState: state
          ? {
              id: state.id,
              summary: state.summary,
              nextAction: state.nextAction,
              confidence: state.confidence,
              metadata: state.metadata,
              updatedAt: state.updatedAt.toISOString(),
            }
          : null,
        nextPosts: priorities.map((p) => ({
          id: p.id,
          rank: p.rank,
          score: p.score,
          funnelLayer: p.funnelLayer,
          topic: p.topic,
          angle: p.angle,
          premise: p.premise,
          justification: p.justification,
          kpiMetric: p.kpiMetric,
          metadata: p.metadata,
        })),
        findings: persisted.map((f) => ({
          id: f.id,
          kind: f.kind,
          content: f.content,
          sourceRef: f.sourceRef,
          metadata: f.metadata,
          createdAt: f.createdAt.toISOString(),
        })),
      },
      { status: 200 }
    );
  }
);
