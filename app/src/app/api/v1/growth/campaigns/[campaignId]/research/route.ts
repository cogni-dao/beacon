// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/growth/campaigns/[campaignId]/research`
 * Purpose: The RESEARCH activity of the beacon growth loop, exposed on-demand (v0).
 *   `POST` loads the campaign's strategy (voice/core_topic/icp/objective), recalls
 *   generic brand-voice playbook from the Dolt knowledge hub, runs the one-pass
 *   research workflow via the LLM, and PERSISTS the resulting tenant `findings`
 *   (insight/pain_point/angle) account-scoped — then returns them.
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
 * Side-effects: IO (HTTP, LLM completion, Doltgres read, Postgres read+write).
 * Links: ../route.ts, docs/spec/beacon-growth-loop-v0.md §2.2/§3/§7,
 *   packages/langgraph-graphs/src/graphs/growth-research/workflow.ts
 * @public
 */

import { randomUUID } from "node:crypto";
import { withTenantScope } from "@cogni/db-client";
import { toUserId, type UserId, userActor } from "@cogni/ids";
import {
  type CampaignStrategy,
  runGrowthResearch,
} from "@cogni/langgraph-graphs";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer, resolveAppDb } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { campaigns, findings } from "@/shared/db/schema";

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

    // Resolve the owning billing account (tenancy axis + LLM billing caller).
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

    // Inject the real LLM: wrap LlmService.completion into the workflow's CompleteFn.
    const llm = container.llmService;
    const complete = async (input: {
      system: string;
      user: string;
    }): Promise<string> => {
      const result = await llm.completion({
        model: RESEARCH_MODEL,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
        caller: {
          billingAccountId: account.id,
          virtualKeyId: account.defaultVirtualKeyId,
          requestId: ctx.reqId,
          traceId: ctx.traceId,
          userId: sessionUser.id,
        },
      });
      return typeof result.message.content === "string"
        ? result.message.content
        : "";
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

    const produced = await runGrowthResearch({
      strategy,
      complete,
      ...(recallPlaybook ? { recallPlaybook } : {}),
    });

    // RLS_SCOPED_WRITES + FINDINGS_ARE_TENANT_DATA: persist account-scoped to
    // Postgres under the user's GUC (the WITH CHECK authorizes the rows). Never Dolt.
    const persisted =
      produced.length > 0
        ? await withTenantScope(db, actorId, async (tx) =>
            tx
              .insert(findings)
              .values(
                produced.map((f) => ({
                  id: randomUUID(),
                  accountId: account.id,
                  campaignId: slug,
                  kind: f.kind,
                  content: f.content,
                }))
              )
              .returning({
                id: findings.id,
                kind: findings.kind,
                content: findings.content,
                createdAt: findings.createdAt,
              })
          )
        : [];

    ctx.log.info(
      {
        route: "growth.campaigns.research",
        campaignId: slug,
        findingsCount: persisted.length,
      },
      "growth.campaign.research_complete"
    );

    return NextResponse.json(
      {
        campaignId: slug,
        findings: persisted.map((f) => ({
          id: f.id,
          kind: f.kind,
          content: f.content,
          createdAt: f.createdAt.toISOString(),
        })),
      },
      { status: 200 }
    );
  }
);
