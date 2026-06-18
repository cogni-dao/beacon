// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/growth/campaigns/[campaignId]`
 * Purpose: Single-campaign mutations on the account-owned `campaigns` record.
 *   `DELETE` removes the campaign row (posts cascade via FK / are explicitly
 *   cleared); `PATCH` flips the lifecycle `status` (draft↔active, plus paused/done).
 * Scope: HTTP boundary + Zod validation + RLS-scoped writes. No business logic
 *   beyond persistence. The KPI/lens read path lives in the collection route.
 * Invariants:
 *   - AUTH_VIA_SESSION: session-cookie required (mirrors the collection route).
 *   - RLS_SCOPED_WRITES: every mutation runs inside `withTenantScope` under the
 *     session user's GUC, so the policy authorizes the row to the user's account —
 *     a non-owner's UPDATE/DELETE simply affects zero rows (→ 404, no existence leak).
 *   - STATUS_PERSIST_ONLY: PATCH only PERSISTS the status field. Wiring
 *     status→Temporal schedule pause/resume (resume on `active`, pause on
 *     `draft`/`paused`) is the HEARTBEAT PR — this route does not touch schedules.
 * Side-effects: IO (HTTP, Postgres write).
 * Links: ../route.ts, docs/spec/beacon-growth-loop-v0.md §3
 * @public
 */

import { withTenantScope } from "@cogni/db-client";
import { type UserId, userActor } from "@cogni/ids";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUser } from "@/app/_lib/auth/session";
import { resolveAppDb } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { campaigns, posts } from "@/shared/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Wire contracts (Zod boundaries)
// ---------------------------------------------------------------------------

/** Status transition body — the draft↔active toggle (plus paused/done). */
const PatchCampaignInputSchema = z.object({
  status: z.enum(["draft", "active", "paused", "done"]),
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/growth/campaigns/[campaignId] — flip lifecycle status
// ---------------------------------------------------------------------------

export const PATCH = wrapRouteHandlerWithLogging<{
  params: Promise<{ campaignId: string }>;
}>(
  { routeId: "growth.campaigns.patch", auth: { mode: "required", getSessionUser } },
  async (ctx, request, sessionUser, context) => {
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (!context) {
      return NextResponse.json({ error: "missing route context" }, { status: 400 });
    }
    const { campaignId } = await context.params;
    const slug = decodeURIComponent(campaignId);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
    }

    const parsed = PatchCampaignInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid input", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const db = resolveAppDb();
    const actorId = userActor(sessionUser.id as UserId);

    // RLS_SCOPED_WRITES + STATUS_PERSIST_ONLY: scoped UPDATE returns the affected
    // rows; a non-owner sees the row filtered out → zero rows → 404 (no leak).
    // NOTE: status→Temporal schedule pause/resume is the HEARTBEAT PR.
    const updated = await withTenantScope(db, actorId, async (tx) =>
      tx
        .update(campaigns)
        .set({ status: parsed.data.status })
        .where(eq(campaigns.campaignId, slug))
        .returning({ campaignId: campaigns.campaignId, status: campaigns.status })
    );

    const row = updated[0];
    if (!row) {
      return NextResponse.json({ error: "campaign not found" }, { status: 404 });
    }

    ctx.log.info(
      {
        route: "growth.campaigns.patch",
        campaignId: slug,
        status: parsed.data.status,
      },
      "growth.campaign.status_updated"
    );

    return NextResponse.json(
      { campaignId: row.campaignId, status: row.status },
      { status: 200 }
    );
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/v1/growth/campaigns/[campaignId] — remove the owned record
// ---------------------------------------------------------------------------

export const DELETE = wrapRouteHandlerWithLogging<{
  params: Promise<{ campaignId: string }>;
}>(
  { routeId: "growth.campaigns.delete", auth: { mode: "required", getSessionUser } },
  async (ctx, _request, sessionUser, context) => {
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (!context) {
      return NextResponse.json({ error: "missing route context" }, { status: 400 });
    }
    const { campaignId } = await context.params;
    const slug = decodeURIComponent(campaignId);

    const db = resolveAppDb();
    const actorId = userActor(sessionUser.id as UserId);

    // RLS_SCOPED_WRITES: delete is scoped to the user's account. `posts`
    // reference the campaign only by the `campaign_id` slug (no FK), so clear the
    // campaign's posts explicitly, both RLS-scoped, in one transaction.
    const deleted = await withTenantScope(db, actorId, async (tx) => {
      await tx.delete(posts).where(eq(posts.campaignId, slug));
      return tx
        .delete(campaigns)
        .where(eq(campaigns.campaignId, slug))
        .returning({ campaignId: campaigns.campaignId });
    });

    if (deleted.length === 0) {
      return NextResponse.json({ error: "campaign not found" }, { status: 404 });
    }

    ctx.log.info(
      { route: "growth.campaigns.delete", campaignId: slug },
      "growth.campaign.deleted"
    );

    return new NextResponse(null, { status: 204 });
  }
);
