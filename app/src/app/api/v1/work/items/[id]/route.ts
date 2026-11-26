// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/work/items/[id]/route`
 * Purpose: HTTP endpoints for getting, patching, and deleting a single work item by ID.
 * Scope: Auth-protected GET (node-local Doltgres first, markdown fallback), PATCH (Doltgres only), and DELETE (Doltgres hard-delete with dolt_log audit).
 * Invariants: VALIDATE_IO, CONTRACTS_ARE_TRUTH, AUTH_VIA_GETSESSIONUSER, PATCH_ALLOWLIST, HARD_DELETE_RECOVERABLE_VIA_DOLT_REVERT.
 * Reason + cites (task.0086): a missing or over-cap reason is HTTP400 `invalid input` with an issue at `reason`; an unknown cite id or a closed inbox is HTTP400 `cite_unresolved`; cites with no resolver wired is HTTP400 `cites_unsupported`; a resolver failure is HTTP503. Nothing is written in each case.
 * Moves (story.0033): `set.moves` with an unknown or deprecated metric id is HTTP400 `cite_unresolved` with an issue at `set.moves`; a bad list is HTTP400 `invalid input`; a non-empty list with no metric wiring is HTTP400 `moves_unsupported`; a resolver failure is HTTP503 `cite_resolver_unavailable`; a baseline failure is HTTP503 `metric_baseline_unavailable`. The client never sets a baseline: the server pins it.
 * Envelope (task.0118): GET returns each `moves` entry with its metric, KPI and goal; `?include=links` adds the first page of citation links (same read as /api/v1/citations/{id}); an unknown include is HTTP400.
 * Read core (story.0085): `handleWorkItemGet` from @cogni/work-items parses `include`/`artifact`, refuses 400/404 and returns the one
 *   terminal event; this route keeps only auth and the store read.
 * Side-effects: IO (HTTP response, filesystem read via port, Doltgres read/write/delete)
 * Links: contracts/work.items.{get,patch,delete}.v1.contract
 * @public
 */

import {
  workItemsDeleteOperation,
  workItemsGetOperation,
  workItemsPatchOperation,
} from "@cogni/node-contracts";
import { handleWorkItemGet, handleWorkItemPatch } from "@cogni/work-items";
import { NextResponse } from "next/server";

import {
  deleteWorkItem,
  getWorkItem,
  patchWorkItem,
  WorkItemForbiddenError,
  WorkItemNotFoundError,
  WorkItemRevisionConflictError,
  WorkItemsBackendNotReadyError,
  WorkItemWriteOutcomeUnknownError,
  WorkItemScoresInvalidError,
  NodeAdminRequiredError,
} from "@/app/_facades/work/items.server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { backendUnavailable } from "../_backend-unavailable";
import { routeAttribution } from "@/bootstrap/write-attribution";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/work/items/:id — Get a single work item by ID from node-local
 * Doltgres, falling back to the legacy markdown port when not imported.
 */
export const GET = wrapRouteHandlerWithLogging<{
  params: Promise<{ id: string }>;
}>(
  { routeId: "work.items.get", auth: { mode: "required", getSessionUser } },
  async (ctx, request, _sessionUser, context) => {
    if (!context) throw new Error("context required for dynamic routes");
    const { id } = await context.params;

    // The package owns the `include`/`artifact` parse, the 400/404/503/499 refusals and the one terminal event (story.0085).
    const result = await handleWorkItemGet(id, {
      searchParams: new URL(request.url).searchParams,
      signal: request.signal,
      read: (itemId, options) =>
        getWorkItem(itemId, { signal: request.signal, ...options }),
      toBody: (item) => workItemsGetOperation.output.parse(item),
      mapNodeError: (e) => {
        if (e instanceof WorkItemWriteOutcomeUnknownError)
          return {
            status: 500,
            errorCode: e.code,
            body: { error: e.message, errorCode: e.code, retryable: false, receipt: e.receipt },
          };
        if (e instanceof WorkItemScoresInvalidError)
          return {
            status: 400,
            errorCode: e.code,
            body: { error: e.message, errorCode: e.code, issues: e.issues },
          };
        return undefined;
      },
    });
    ctx.log.info(result.event, result.event.event);
    return NextResponse.json(result.body, { status: result.status });
  }
);

/**
 * PATCH /api/v1/work/items/:id — Patch a work item (Doltgres only).
 *
 * The immutable authenticated principal must match the creator stamped when
 * the row was inserted. The path id remains authoritative over request data.
 */
export const PATCH = wrapRouteHandlerWithLogging<{
  params: Promise<{ id: string }>;
}>(
  { routeId: "work.items.patch", auth: { mode: "required", getSessionUser } },
  async (ctx, request, sessionUser, context) => {
    if (!context) throw new Error("context required for dynamic routes");
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    // The package owns parse, refusals and the one terminal event (bug.0063); this route keeps auth, the actor and node errors.
    const attribution = routeAttribution(sessionUser.id);
    const result = await handleWorkItemPatch(id, {
      readJson: () => request.json(),
      parse: (body) => workItemsPatchOperation.input.safeParse(body),
      write: (input) =>
        patchWorkItem(
          input,
          {
            id: sessionUser.id,
            walletAddress: sessionUser.walletAddress,
          },
          attribution,
        ),
      attribution,
      toBody: (patched) => workItemsPatchOperation.output.parse(patched),
      mapNodeError: (e) => {
        if (e instanceof WorkItemNotFoundError)
          return { status: 404, errorCode: "not_found", body: { error: e.message } };
        if (e instanceof WorkItemForbiddenError)
          return { status: 403, errorCode: "forbidden", body: { error: e.message } };
        if (e instanceof NodeAdminRequiredError)
          return {
            status: e.status,
            errorCode: e.errorCode,
            body: { error: e.message, errorCode: e.errorCode, action: e.action },
          };
        return undefined;
      },
    });
    ctx.log.info(result.event, result.event.event);
    return NextResponse.json(result.body, { status: result.status });
  }
);

/**
 * DELETE /api/v1/work/items/:id — Hard-delete a work item from Doltgres.
 *
 * The deletion is captured as a dolt_log commit; recovery via dolt_revert
 * remains available. Idempotent at the contract level: a missing id returns 404,
 * not 500. Returns `{id, deleted: true}` on success.
 */
export const DELETE = wrapRouteHandlerWithLogging<{
  params: Promise<{ id: string }>;
}>(
  { routeId: "work.items.delete", auth: { mode: "required", getSessionUser } },
  async (ctx, _request, sessionUser, context) => {
    if (!context) throw new Error("context required for dynamic routes");
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;

    const inputParse = workItemsDeleteOperation.input.safeParse({ id });
    if (!inputParse.success) {
      return NextResponse.json(
        { error: "invalid input", issues: inputParse.error.issues },
        { status: 400 }
      );
    }

    try {
      const deleted = await deleteWorkItem(id, {
        id: sessionUser.id,
      });
      if (!deleted) {
        return NextResponse.json(
          { error: `Work item not found: ${id}` },
          { status: 404 }
        );
      }
      ctx.log.info({ workItemId: id }, "work.items.delete_success");
      return NextResponse.json(
        workItemsDeleteOperation.output.parse({ id, deleted: true })
      );
    } catch (e) {
      if (e instanceof WorkItemRevisionConflictError) {
        return NextResponse.json({ error: e.message, errorCode: "work_item_revision_conflict", expectedRevision: e.expectedRevision, currentRevision: e.currentRevision }, { status: 409 });
      }
      if (e instanceof WorkItemForbiddenError) {
        return NextResponse.json({ error: e.message }, { status: 403 });
      }
      if (e instanceof WorkItemWriteOutcomeUnknownError) {
        return NextResponse.json({ error: e.message, errorCode: e.code, retryable: false, receipt: e.receipt }, { status: 500 });
      }
      if (e instanceof WorkItemScoresInvalidError) {
        return NextResponse.json({ error: e.message, errorCode: e.code, issues: e.issues }, { status: 400 });
      }
      if (e instanceof WorkItemsBackendNotReadyError) {
        return backendUnavailable(ctx, e.reason);
      }
      throw e;
    }
  }
);
