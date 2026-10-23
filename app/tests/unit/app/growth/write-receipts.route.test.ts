// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/unit/app/growth/write-receipts.route`
 * Purpose: Exercise actual custom growth handlers with published typed write failures.
 * Scope: Mock service/job boundaries and logging wrapper plumbing, never HTTP responses.
 * Invariants: UNKNOWN_NEVER_REPLAYED, CAMPAIGN_INSERT_NOT_REPLAYED, OPS_AUTH_RETAINED.
 * Side-effects: none
 * Links: src/app/api/v1/growth/campaigns/route.ts, src/app/api/internal/ops/growth/resolve/route.ts
 * @internal
 */

import {
  KnowledgeBusyError,
  KnowledgeWriteConflictError,
  KnowledgeWriteOutcomeUnknownError,
  KnowledgeWriteScopeRequiredError,
} from "@cogni/knowledge-store";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "8a64f62e-07cb-4ea1-954a-5768b2db9825" } as { id: string } | null,
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  event: vi.fn(),
  job: vi.fn(),
  container: vi.fn(),
  db: vi.fn(),
  tenant: vi.fn(),
}));
vi.mock("@/bootstrap/http", () => ({
  wrapRouteHandlerWithLogging:
    (_options: unknown, handler: (...args: unknown[]) => unknown) =>
    (request: Request) =>
      handler(
        { reqId: "owned-request", routeId: "growth", log: mocks.log },
        request,
        mocks.user,
      ),
}));
vi.mock("@/bootstrap/container", () => ({
  getContainer: mocks.container,
  resolveAppDb: mocks.db,
}));
vi.mock("@/bootstrap/jobs/resolveEngagementCampaigns.job", () => ({
  runResolveEngagementCampaignsJob: mocks.job,
}));
vi.mock("@/app/_lib/auth/session", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/shared/env", () => ({
  serverEnv: () => ({ INTERNAL_OPS_TOKEN: "owned-ops-token" }),
}));
vi.mock("@/shared/observability", () => ({
  EVENT_NAMES: { GROWTH_RESOLVE_COMPLETE: "growth.resolve.complete" },
  logEvent: mocks.event,
}));
vi.mock("@cogni/db-client", () => ({ withTenantScope: mocks.tenant }));

import { POST as createCampaign } from "@/app/api/v1/growth/campaigns/route";
import { POST as resolveGrowth } from "@/app/api/internal/ops/growth/resolve/route";

const request = () =>
  new NextRequest("https://beacon.invalid/api/v1/growth/campaigns", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer owned-ops-token",
    },
    body: JSON.stringify({
      campaignId: "owned-campaign",
      title: "One original intent",
    }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: "8a64f62e-07cb-4ea1-954a-5768b2db9825" };
});

const failures = [
  {
    name: "unknown",
    make: () =>
      new KnowledgeWriteOutcomeUnknownError("owned-op", "ops/owned-op"),
    status: 409,
    body: {
      errorCode: "knowledge_write_outcome_unknown",
      retryable: false,
      operationId: "owned-op",
      branch: "ops/owned-op",
      commitHash: null,
    },
  },
  {
    name: "conflict",
    make: () => new KnowledgeWriteConflictError("owned-entry"),
    status: 409,
    body: {
      errorCode: "knowledge_write_conflict",
      retryable: false,
      entryId: "owned-entry",
    },
  },
  {
    name: "scope",
    make: () => new KnowledgeWriteScopeRequiredError(),
    status: 500,
    body: { errorCode: "knowledge_write_scope_required", retryable: false },
  },
  {
    name: "busy",
    make: () => new KnowledgeBusyError(),
    status: 503,
    body: { retryable: true },
  },
];

describe("Beacon custom growth write receipts", () => {
  for (const boundary of ["domain", "hypothesis", "resolver"] as const) {
    for (const failure of failures) {
      it(`${boundary}: ${failure.name} preserves lookup and retry policy without replay`, async () => {
        const mutation = vi.fn().mockRejectedValue(failure.make());
        const hypothesize = boundary === "hypothesis" ? mutation : vi.fn();
        mocks.container.mockReturnValue({
          knowledgeStorePort: {
            domainExists: vi.fn().mockResolvedValue(boundary !== "domain"),
            registerDomain: mutation,
          },
          edoCapability: { hypothesize },
          accountsForUser: () => ({
            getOrCreateBillingAccountForUser: vi
              .fn()
              .mockResolvedValue({ id: "owned-account" }),
          }),
        });
        if (boundary === "resolver") mocks.job.mockImplementation(mutation);
        const response = await (boundary === "resolver"
          ? resolveGrowth(request())
          : createCampaign(request()));
        expect(response.status).toBe(failure.status);
        expect(await response.json()).toMatchObject(failure.body);
        expect(response.headers.get("retry-after")).toBe(
          failure.name === "busy" ? "2" : null,
        );
        expect(mutation).toHaveBeenCalledTimes(1);
        expect(mocks.db).not.toHaveBeenCalled();
        expect(mocks.tenant).not.toHaveBeenCalled();
        if (boundary === "domain") expect(hypothesize).not.toHaveBeenCalled();
        if (boundary === "resolver")
          expect(mocks.event).toHaveBeenCalledWith(
            mocks.log,
            "growth.resolve.complete",
            expect.objectContaining({
              status: failure.status,
              outcome: "error",
            }),
          );
      });
    }
  }

  it("keeps a real acknowledged commit hash in the terminal job receipt", async () => {
    const hash = "0123456789abcdef0123456789abcdef";
    mocks.job.mockRejectedValue(
      new KnowledgeWriteOutcomeUnknownError("owned-op", "ops/owned-op", hash),
    );
    const response = await resolveGrowth(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      retryable: false,
      commitHash: hash,
    });
    expect(mocks.job).toHaveBeenCalledTimes(1);
  });

  it("keeps internal bearer denial before the job", async () => {
    const response = await resolveGrowth(
      new NextRequest("https://beacon.invalid/internal", { method: "POST" }),
    );
    expect(response.status).toBe(401);
    expect(mocks.job).not.toHaveBeenCalled();
  });

  it("keeps unauthenticated campaign denial before billing and knowledge", async () => {
    mocks.user = null;
    const response = await createCampaign(request());
    expect(response.status).toBe(401);
    expect(mocks.container).not.toHaveBeenCalled();
  });

  it("retains the owned PostgreSQL duplicate campaign409", async () => {
    const hypothesize = vi
      .fn()
      .mockResolvedValue({ id: "campaign:owned-campaign" });
    mocks.container.mockReturnValue({
      knowledgeStorePort: { domainExists: vi.fn().mockResolvedValue(true) },
      edoCapability: { hypothesize },
      accountsForUser: () => ({
        getOrCreateBillingAccountForUser: vi
          .fn()
          .mockResolvedValue({ id: "owned-account" }),
      }),
    });
    mocks.db.mockReturnValue({});
    mocks.tenant.mockRejectedValue(
      new Error("duplicate key violates campaign unique constraint"),
    );
    const response = await createCampaign(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "campaign 'owned-campaign' already exists",
    });
    expect(hypothesize).toHaveBeenCalledTimes(1);
    expect(mocks.tenant).toHaveBeenCalledTimes(1);
  });

  it("does not swallow or retry an unrelated job failure", async () => {
    const error = new Error("unexpected service failure");
    mocks.job.mockRejectedValue(error);
    await expect(resolveGrowth(request())).rejects.toBe(error);
    expect(mocks.job).toHaveBeenCalledTimes(1);
  });
});
