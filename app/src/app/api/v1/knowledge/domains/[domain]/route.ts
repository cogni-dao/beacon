// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/** Authenticated domain CRUD delegates; storage owns atomicity, no-ops and nonempty refusal. */
import {
  DomainNotEmptyError,
  DomainNotRegisteredError,
  KnowledgeBusyError,
  KnowledgeWriteConflictError,
  KnowledgeWriteOutcomeUnknownError,
  KnowledgeWriteScopeRequiredError,
} from "@cogni/knowledge-store";
import {
  DomainIdSchema,
  DomainSchema,
  DomainsDeleteResponseSchema,
  type DomainsErrorResponse,
  DomainsErrorResponseSchema,
  DomainsUpdateBodySchema,
} from "@cogni/node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ domain: string }> };

function error(status: number, body: DomainsErrorResponse) {
  return NextResponse.json(DomainsErrorResponseSchema.parse(body), {
    status,
    ...(body.errorCode === "knowledge_busy" && {
      headers: { "Retry-After": "2" },
    }),
  });
}

function writeError(e: unknown): NextResponse {
  if (e instanceof DomainNotRegisteredError)
    return error(404, { error: e.message, errorCode: "domain_not_found" });
  if (e instanceof DomainNotEmptyError)
    return error(409, {
      error: e.message,
      errorCode: "domain_not_empty",
      entryCount: e.entryCount,
    });
  if (e instanceof KnowledgeWriteOutcomeUnknownError)
    return error(409, {
      error: e.message,
      errorCode: "knowledge_write_outcome_unknown",
      retryable: false,
      operationId: e.operationId,
      branch: e.branch,
      commitHash: e.commitHash ?? null,
    });
  if (e instanceof KnowledgeWriteScopeRequiredError)
    return error(500, {
      error: e.message,
      errorCode: "knowledge_write_scope_required",
      retryable: false,
    });
  if (e instanceof KnowledgeWriteConflictError)
    return error(409, {
      error: e.message,
      errorCode: "knowledge_write_conflict",
      retryable: false,
      entryId: e.entryId,
    });
  if (e instanceof KnowledgeBusyError)
    return error(503, {
      error: e.message,
      errorCode: "knowledge_busy",
      retryable: true,
    });
  throw e;
}

function route(method: "get" | "update" | "delete") {
  return wrapRouteHandlerWithLogging<Context>(
    {
      routeId: `knowledge.domains.${method}`,
      auth: { mode: "required", getSessionUser },
    },
    async (ctx, request, user, context) => {
      if (!user)
        return error(401, { error: "unauthorized", errorCode: "unauthorized" });
      const port = getContainer().knowledgeStorePort;
      if (!port)
        return error(503, {
          error: "knowledge store not configured",
          errorCode: "store_not_configured",
        });
      if (!context) throw new Error("context required for dynamic routes");
      const input = DomainIdSchema.safeParse((await context.params).domain);
      if (!input.success)
        return error(400, {
          error: "invalid domain id",
          errorCode: "invalid_input",
          issues: input.error.issues,
        });
      const id = input.data;
      try {
        if (method === "get") {
          const domain = await port.getDomain(id);
          return domain
            ? NextResponse.json(DomainSchema.parse(domain))
            : error(404, {
                error: `domain '${id}' not registered`,
                errorCode: "domain_not_found",
              });
        }
        if (method === "update") {
          let body: unknown;
          try {
            body = await request.json();
          } catch {
            return error(400, {
              error: "invalid JSON body",
              errorCode: "invalid_json",
            });
          }
          const patch = DomainsUpdateBodySchema.safeParse(body);
          if (!patch.success)
            return error(400, {
              error: "invalid input",
              errorCode: "invalid_input",
              issues: patch.error.issues,
            });
          const updated = await port.updateDomain(id, {
            ...(patch.data.name !== undefined && { name: patch.data.name }),
            ...(patch.data.description !== undefined && {
              description: patch.data.description,
            }),
          });
          ctx.log.info(
            {
              domainId: id,
              userId: user.id,
              changedFields: Object.keys(patch.data),
            },
            "knowledge.domains.update_success",
          );
          return NextResponse.json(DomainSchema.parse(updated));
        }
        if (["meta", "mission", "strategy"].includes(id))
          return error(409, {
            error: `domain '${id}' is a baseline domain and cannot be deleted`,
            errorCode: "domain_protected",
          });
        await port.deleteDomain(id);
        ctx.log.info(
          { domainId: id, userId: user.id },
          "knowledge.domains.delete_success",
        );
        return NextResponse.json(
          DomainsDeleteResponseSchema.parse({ id, deleted: true }),
        );
      } catch (e) {
        return writeError(e);
      }
    },
  );
}

export const GET = route("get");
export const PATCH = route("update");
export const DELETE = route("delete");
