// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/growth/campaigns/[campaignId]/posts/[postId]`
 * Purpose: The DRAFT REVIEW + REFINE surface's write boundary — per-draft human
 *   actions on a generated `posts` row. `PATCH` takes one `action`:
 *     - `approve` → status 'approved'
 *     - `reject`  → status 'rejected'
 *     - `edit`    → persist the human-edited `text` (status unchanged)
 *     - `refine`  → regenerate THIS draft via the gated `chatCompletion` facade
 *       (optionally steered by a human `feedback` note), bumping `revision` and
 *       returning to status 'generated' for re-review. A NEW revision in place.
 *   All writes are account-scoped under the session user's GUC (RLS-correct).
 * Scope: HTTP boundary + Zod validation + RLS-scoped reads/writes + (for refine)
 *   the same gated LLM seam the generate route uses. The refine THINKING lives in
 *   the pure `refineSingleDraft` workflow (`@cogni/langgraph-graphs`).
 * Invariants:
 *   - AUTH_VIA_SESSION: session-cookie required (mirrors the generate/patch routes).
 *   - RLS_SCOPED_READS_WRITES: every campaign/post read + post update runs inside
 *     `withTenantScope` under the session user's GUC — never service-role. A non-owner
 *     sees the row filtered out → zero rows → 404 (no existence leak).
 *   - REFINE_THROUGH_GATED_FACADE: the refine LLM call goes through `chatCompletion`
 *     (BILLABLE_AI_THROUGH_EXECUTOR) — NEVER a raw `LlmService.completion`. Same seam
 *     as the generate route; the billing fence holds for the human Refine action too.
 *   - REFINE_NEVER_DESTROYS: a failed/empty refine keeps the original draft text +
 *     revision (refine never blanks a draft); only a successful rewrite bumps revision.
 *   - REFINE_BUMPS_REVISION: a successful refine sets `revision = prior + 1` and resets
 *     `status` to 'generated' so the new revision flows back through review.
 *   - POSTS_ARE_TENANT_DATA: posts are Postgres-only, never Doltgres.
 * Side-effects: IO (HTTP, Postgres read+write, LLM completion on refine, Doltgres recall).
 * Links: ../../generate/route.ts, ../../route.ts,
 *   packages/langgraph-graphs/src/graphs/growth-generate/workflow.ts (refineSingleDraft),
 *   app/src/app/(app)/growth/_api/mutateCampaign.ts
 * @public
 */

import { withTenantScope } from "@cogni/db-client";
import { toUserId, type UserId, userActor } from "@cogni/ids";
import {
  type CampaignStrategy,
  type GenerateFinding,
  refineSingleDraft,
} from "@cogni/langgraph-graphs";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { chatCompletion } from "@/app/_facades/ai/completion.server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer, resolveAppDb } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { campaigns, findings, posts } from "@/shared/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Constants (mirror the generate route's gated-facade wiring)
// ---------------------------------------------------------------------------

const DOMAIN_BRAND_VOICE = "beacon-brand-voice";
const REFINE_MODEL = "gpt-4o-mini";
const PLAYBOOK_RECALL_LIMIT = 5;
const FINDINGS_CONTEXT_LIMIT = 20;

/** Funnel layers the queue is classified into (matches the workflow + schema CHECK). */
type FunnelLayer = "tofu" | "mofu" | "bofu";
function asFunnelLayer(raw: string | null | undefined): FunnelLayer {
  return raw === "mofu" || raw === "bofu" ? raw : "tofu";
}

// ---------------------------------------------------------------------------
// Wire contract (Zod boundary)
// ---------------------------------------------------------------------------

/**
 * The per-draft review action. `edit` requires `text`; `refine` accepts an optional
 * human `feedback` note steering the revision. approve/reject carry no payload.
 */
const PatchPostInputSchema = z.union([
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject") }),
  z.object({ action: z.literal("edit"), text: z.string().trim().min(1).max(8000) }),
  z.object({
    action: z.literal("refine"),
    feedback: z.string().trim().max(2000).optional(),
  }),
]);

// ---------------------------------------------------------------------------
// PATCH /api/v1/growth/campaigns/[campaignId]/posts/[postId]
// ---------------------------------------------------------------------------

export const PATCH = wrapRouteHandlerWithLogging<{
  params: Promise<{ campaignId: string; postId: string }>;
}>(
  {
    routeId: "growth.campaigns.posts.patch",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx, request, sessionUser, context) => {
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (!context) {
      return NextResponse.json(
        { error: "missing route context" },
        { status: 400 }
      );
    }
    const { campaignId, postId } = await context.params;
    const slug = decodeURIComponent(campaignId);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
    }

    const parsed = PatchPostInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid input", issues: parsed.error.issues },
        { status: 400 }
      );
    }
    const input = parsed.data;

    const db = resolveAppDb();
    const actorId = userActor(sessionUser.id as UserId);

    // ---- approve / reject / edit: a single RLS-scoped UPDATE ----------------
    if (input.action !== "refine") {
      const set =
        input.action === "approve"
          ? { status: "approved" as const }
          : input.action === "reject"
            ? { status: "rejected" as const }
            : { text: input.text };

      // RLS_SCOPED_WRITES: scope the UPDATE to this post AND campaign; a non-owner
      // (or wrong campaign) matches zero rows → 404 (no existence leak).
      const updated = await withTenantScope(db, actorId, async (tx) =>
        tx
          .update(posts)
          .set(set)
          .where(and(eq(posts.id, postId), eq(posts.campaignId, slug)))
          .returning({
            id: posts.id,
            status: posts.status,
            text: posts.text,
            revision: posts.revision,
            score: posts.score,
          })
      );
      const row = updated[0];
      if (!row) {
        return NextResponse.json({ error: "post not found" }, { status: 404 });
      }

      ctx.log.info(
        {
          route: "growth.campaigns.posts.patch",
          campaignId: slug,
          postId,
          action: input.action,
          status: row.status,
        },
        "growth.campaign.post_reviewed"
      );

      return NextResponse.json(
        {
          id: row.id,
          status: row.status,
          text: row.text,
          revision: row.revision,
          score: row.score,
        },
        { status: 200 }
      );
    }

    // ---- refine: regenerate THIS draft through the GATED facade -------------

    // Load the campaign DNA, its findings, AND the target post — all RLS-scoped.
    const loaded = await withTenantScope(db, actorId, async (tx) => {
      const campaignRows = await tx
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
      const campaignRow = campaignRows[0];

      const postRows = await tx
        .select({
          id: posts.id,
          funnelLayer: posts.funnelLayer,
          topic: posts.topic,
          angle: posts.angle,
          text: posts.text,
          revision: posts.revision,
        })
        .from(posts)
        .where(and(eq(posts.id, postId), eq(posts.campaignId, slug)))
        .limit(1);
      const postRow = postRows[0];

      const findingRows = postRow
        ? await tx
            .select({ kind: findings.kind, content: findings.content })
            .from(findings)
            .where(eq(findings.campaignId, slug))
        : [];

      return { campaignRow, postRow, findingRows };
    });

    if (!loaded.campaignRow || !loaded.postRow) {
      return NextResponse.json({ error: "post not found" }, { status: 404 });
    }
    const { campaignRow, postRow, findingRows } = loaded;

    const strategy: CampaignStrategy = {
      campaignId: campaignRow.campaignId,
      brief: campaignRow.brief,
      voice: campaignRow.voice,
      coreTopic: campaignRow.coreTopic,
      icp: campaignRow.icp,
      objective: campaignRow.objective,
    };
    const generateFindings: GenerateFinding[] = findingRows
      .slice(0, FINDINGS_CONTEXT_LIMIT)
      .map((f) => ({ kind: f.kind, content: f.content }));

    // REFINE_THROUGH_GATED_FACADE: the SAME chatCompletion seam the generate route
    // uses (BILLABLE_AI_THROUGH_EXECUTOR — preflight credit gate + usage commit).
    const complete = async (cInput: {
      system: string;
      user: string;
    }): Promise<string> => {
      const result = await chatCompletion(
        {
          messages: [
            { role: "system", content: cInput.system },
            { role: "user", content: cInput.user },
          ],
          modelRef: { providerKey: "platform", modelId: REFINE_MODEL },
          sessionUser,
        },
        ctx
      );
      const content = result.choices[0]?.message.content;
      return typeof content === "string" ? content : "";
    };

    // Generic brand-voice playbook recall only (never tenant data); fail-open.
    const store = getContainer().knowledgeStorePort;
    const recallPlaybook = store
      ? async (query: string): Promise<string[]> => {
          const hits = await store.searchKnowledge(DOMAIN_BRAND_VOICE, query, {
            limit: PLAYBOOK_RECALL_LIMIT,
          });
          return hits.map((h) => `${h.title}: ${h.content}`.slice(0, 500));
        }
      : undefined;

    const revised = await refineSingleDraft({
      strategy,
      draft: {
        funnelLayer: asFunnelLayer(postRow.funnelLayer),
        topic: postRow.topic ?? "",
        angle: postRow.angle ?? "",
        text: postRow.text,
      },
      findings: generateFindings,
      ...(input.feedback ? { feedback: input.feedback } : {}),
      complete,
      ...(recallPlaybook ? { recallPlaybook } : {}),
    });

    // REFINE_NEVER_DESTROYS: no usable rewrite → keep the original draft untouched.
    if (!revised) {
      return NextResponse.json(
        { error: "refine produced no usable revision; original draft kept" },
        { status: 502 }
      );
    }

    // REFINE_BUMPS_REVISION: persist the new revision in place, back to 'generated'
    // so it flows through review again. RLS-scoped UPDATE (404 if not owned).
    const updated = await withTenantScope(db, actorId, async (tx) =>
      tx
        .update(posts)
        .set({
          text: revised.text,
          angle: revised.angle,
          topic: revised.topic,
          revision: postRow.revision + 1,
          status: "generated" as const,
        })
        .where(and(eq(posts.id, postId), eq(posts.campaignId, slug)))
        .returning({
          id: posts.id,
          status: posts.status,
          text: posts.text,
          revision: posts.revision,
          score: posts.score,
        })
    );
    const row = updated[0];
    if (!row) {
      return NextResponse.json({ error: "post not found" }, { status: 404 });
    }

    ctx.log.info(
      {
        route: "growth.campaigns.posts.patch",
        campaignId: slug,
        postId,
        action: "refine",
        revision: row.revision,
        hadFeedback: Boolean(input.feedback),
      },
      "growth.campaign.post_refined"
    );

    return NextResponse.json(
      {
        id: row.id,
        status: row.status,
        text: row.text,
        revision: row.revision,
        score: row.score,
      },
      { status: 200 }
    );
  }
);
