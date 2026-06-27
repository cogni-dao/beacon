// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/growth/campaigns/[campaignId]/generate`
 * Purpose: The GENERATE activity of the beacon growth loop, exposed on-demand (v0).
 *   `POST` loads the campaign's strategy (voice/core_topic/icp/objective/funnel_targets)
 *   AND its research `findings`, recalls generic brand-voice playbook from the Dolt
 *   knowledge hub, runs the pure `runGrowthGenerate` workflow (which POPULATES THE
 *   FUNNEL — a spread of drafts across TOFU/MOFU/BOFU, volume DERIVED from
 *   `funnel_targets`, never a hardcoded N), and PERSISTS the drafts as `posts`
 *   (status 'generated', score null, revision 0) account-scoped — then returns them.
 * Scope: HTTP boundary + auth + orchestration. The thinking lives in the pure
 *   `runGrowthGenerate` workflow (`@cogni/langgraph-graphs`); this route wires the
 *   real LLM + knowledge recall + RLS-scoped read/persist. No Temporal (v0 thin,
 *   on-demand — the loop's cron driver lands with the heartbeat PR).
 * Invariants:
 *   - AUTH_VIA_SESSION: session-cookie required (mirrors the research/campaigns routes).
 *   - RLS_SCOPED_READS_WRITES: the campaign read, the findings read, AND the posts
 *     insert all run inside `withTenantScope` under the session user's GUC — never
 *     service-role.
 *   - GENERATE_FILLS_QUEUE_ONLY: rows land as status 'generated' (the queue). This
 *     route NEVER posts/publishes — that is the later POST stage.
 *   - POSTS_ARE_TENANT_DATA: posts are written to Postgres only, NEVER Doltgres.
 *   - VOLUME_FROM_FUNNEL_TARGETS: the workflow derives per-layer count from
 *     `campaigns.funnel_targets`; this route does NOT impose a count.
 *   - PLAYBOOK_RECALL_FAIL_OPEN: a missing/empty knowledge hub degrades to no
 *     playbook (the workflow still produces drafts).
 *   - IDEMPOTENCY_APPEND_V0: each call appends fresh drafts (v0; de-dupe is later).
 * Side-effects: IO (HTTP, LLM completion, Doltgres read, Postgres read+write).
 * Links: ../research/route.ts, ../route.ts, docs/spec/beacon-growth-loop-v0.md §0/§3/§4,
 *   packages/langgraph-graphs/src/graphs/growth-generate/workflow.ts
 * @public
 */

import { randomUUID } from "node:crypto";
import { deriveMoltbookPayloadFromDraft } from "@cogni/ai-tools";
import { withTenantScope } from "@cogni/db-client";
import { toUserId, type UserId, userActor } from "@cogni/ids";
import {
  type CampaignStrategy,
  type FunnelTargets,
  type GenerateFinding,
  runGrowthGenerate,
} from "@cogni/langgraph-graphs";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { chatCompletion } from "@/app/_facades/ai/completion.server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer, resolveAppDb } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { campaigns, findings, posts } from "@/shared/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Generic brand-voice playbook domain recalled to ground the generate activity. */
const DOMAIN_BRAND_VOICE = "beacon-brand-voice";
/** Default model for the v0 generate pass (cheap; the drafts are small). */
const GENERATE_MODEL = "gpt-4o-mini";
/** How many playbook notes to recall from the Dolt hub. */
const PLAYBOOK_RECALL_LIMIT = 5;
/** Cap on findings fed into the prompt (defensive context-size guard). */
const FINDINGS_CONTEXT_LIMIT = 20;

/** Funnel layers the queue is classified into (matches the workflow + schema CHECK). */
type FunnelLayer = "tofu" | "mofu" | "bofu";

/**
 * Narrow the campaign's raw jsonb `funnel_targets` into the workflow's `FunnelTargets`
 * shape ({tofu?,mofu?,bofu?} of non-negative numbers). Unknown/garbage → undefined,
 * which the workflow handles by falling back to its modest per-layer default.
 */
function asFunnelTargets(raw: unknown): FunnelTargets | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const rec = raw as Record<string, unknown>;
  const out: FunnelTargets = {};
  for (const layer of ["tofu", "mofu", "bofu"] as const) {
    const v = rec[layer];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
      out[layer satisfies FunnelLayer] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// ---------------------------------------------------------------------------
// POST /api/v1/growth/campaigns/[campaignId]/generate — run the activity
// ---------------------------------------------------------------------------

export const POST = wrapRouteHandlerWithLogging<{
  params: Promise<{ campaignId: string }>;
}>(
  {
    routeId: "growth.campaigns.generate",
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

    // RLS_SCOPED_READS: load the campaign strategy + its findings under the user's
    // GUC; a non-owner sees the row filtered out → zero rows → 404 (no existence leak).
    const loaded = await withTenantScope(db, actorId, async (tx) => {
      const campaignRows = await tx
        .select({
          campaignId: campaigns.campaignId,
          brief: campaigns.brief,
          voice: campaigns.voice,
          coreTopic: campaigns.coreTopic,
          icp: campaigns.icp,
          objective: campaigns.objective,
          funnelTargets: campaigns.funnelTargets,
        })
        .from(campaigns)
        .where(eq(campaigns.campaignId, slug))
        .limit(1);
      const campaignRow = campaignRows[0];
      if (!campaignRow) return { campaignRow: undefined, findingRows: [] };

      const findingRows = await tx
        .select({ kind: findings.kind, content: findings.content })
        .from(findings)
        .where(eq(findings.campaignId, slug));

      return { campaignRow, findingRows };
    });

    if (!loaded.campaignRow) {
      return NextResponse.json(
        { error: "campaign not found" },
        { status: 404 }
      );
    }
    const { campaignRow, findingRows } = loaded;

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
    const funnelTargets = asFunnelTargets(campaignRow.funnelTargets);
    const generateFindings: GenerateFinding[] = findingRows
      .slice(0, FINDINGS_CONTEXT_LIMIT)
      .map((f) => ({ kind: f.kind, content: f.content }));

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
          modelRef: { providerKey: "platform", modelId: GENERATE_MODEL },
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

    const drafts = await runGrowthGenerate({
      strategy,
      findings: generateFindings,
      ...(funnelTargets ? { funnelTargets } : {}),
      complete,
      ...(recallPlaybook ? { recallPlaybook } : {}),
    });

    // RLS_SCOPED_WRITES + POSTS_ARE_TENANT_DATA + GENERATE_FILLS_QUEUE_ONLY: persist
    // account-scoped to Postgres under the user's GUC as status 'generated' (the
    // queue), score null, revision 0. Never Dolt, never published.
    const persisted =
      drafts.length > 0
        ? await withTenantScope(db, actorId, async (tx) =>
            tx
              .insert(posts)
              .values(
                drafts.map((d) => {
                  const moltbook =
                    d.channel === "moltbook"
                      ? deriveMoltbookPayloadFromDraft({
                          text: d.text,
                          ...(d.title ? { title: d.title } : {}),
                          angle: d.angle,
                          topic: d.topic,
                        })
                      : null;
                  return {
                    id: randomUUID(),
                    accountId: account.id,
                    campaignId: slug,
                    // idea_key groups per-platform variants of one core idea; v0 is
                    // single-channel single-post, so each draft is its own idea.
                    ideaKey: randomUUID(),
                    funnelLayer: d.funnelLayer,
                    topic: d.topic,
                    angle: d.angle,
                    channel: d.channel,
                    kind: d.kind,
                    text: d.text,
                    moltbookSubmoltName: moltbook?.submoltName ?? null,
                    moltbookTitle: moltbook?.title ?? null,
                    moltbookContent: moltbook?.content ?? null,
                    moltbookType: moltbook?.type ?? null,
                    status: "generated" as const,
                    // The workflow stamps `revision` per draft: 0 = raw draft pass only,
                    // 1 = survived the critique→revise refine pass. Persist that so the
                    // queue reflects which posts went through the quality loop.
                    revision: d.revision,
                  };
                })
              )
              .returning({
                id: posts.id,
                funnelLayer: posts.funnelLayer,
                topic: posts.topic,
                angle: posts.angle,
                channel: posts.channel,
                text: posts.text,
                status: posts.status,
                createdAt: posts.createdAt,
              })
          )
        : [];

    ctx.log.info(
      {
        route: "growth.campaigns.generate",
        campaignId: slug,
        findingsCount: generateFindings.length,
        postsCount: persisted.length,
      },
      "growth.campaign.generate_complete"
    );

    return NextResponse.json(
      {
        campaignId: slug,
        posts: persisted.map((p) => ({
          id: p.id,
          funnelLayer: p.funnelLayer,
          topic: p.topic,
          angle: p.angle,
          channel: p.channel,
          text: p.text,
          status: p.status,
          createdAt: p.createdAt.toISOString(),
        })),
      },
      { status: 200 }
    );
  }
);
