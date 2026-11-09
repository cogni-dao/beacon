// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/unit/app/_facades/metrics-facade`
 * Purpose: Route-binding proof for the metrics facade after adopting `@cogni-dao/metrics/http` (story.0021).
 * Scope: Verifies the container ports are wired into the package handlers and that responses carry the no-store header. Parsing, contract validation and error mapping are tested in the package.
 * Invariants: Unexpected failures are logged once and answered `metrics_unavailable` 503.
 * Side-effects: none
 * Links: app/src/app/_facades/metrics.server.ts
 * @public
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const error = vi.fn();
const container = {
  log: { error },
  goalMetrics: undefined as unknown,
  goalProgress: vi.fn(),
  knowledgeStorePort: undefined as unknown,
};

vi.mock("@/bootstrap/container", () => ({ getContainer: () => container }));

import {
  metricHandlers,
  metricHttpError,
  metricResponse,
} from "@/app/_facades/metrics.server";

const progress = {
  goals: [],
  asOf: "2026-01-01T00:00:00.000Z",
  environment: "test",
};

describe("metrics facade", () => {
  beforeEach(() => {
    error.mockClear();
    container.goalMetrics = undefined;
    container.goalProgress.mockReset();
    container.knowledgeStorePort = undefined;
  });

  it("answers goals from the container goal reader", async () => {
    container.goalProgress.mockResolvedValue(progress);
    const result = await metricHandlers().goals();
    expect(result).toMatchObject({ ok: true, status: 200 });
    const response = metricResponse(result);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual(progress);
  });

  it("answers 503 metrics_unavailable when the node has no metrics service", async () => {
    const response = metricResponse(
      await metricHandlers().list(new URLSearchParams()),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "metrics_unavailable" });
  });

  it("logs unexpected failures once and never leaks the message", async () => {
    container.goalProgress.mockRejectedValue(new Error("db password leaked"));
    const response = metricResponse(await metricHandlers().goals());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("leaked");
    expect(error).toHaveBeenCalledWith(
      { errorCode: "metrics_unavailable" },
      "metric.operation_failed",
    );
  });

  it("maps a raised route failure through the same error contract", async () => {
    const response = metricHttpError(new Error("route_context_missing"));
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("does not resolve a subject that is not a goal or hypothesis", async () => {
    container.goalMetrics = {};
    container.knowledgeStorePort = {
      getKnowledge: vi
        .fn()
        .mockResolvedValue({ id: "x", title: "t", entryType: "note" }),
    };
    const result = await metricHandlers().subject("x");
    expect(result).toMatchObject({ ok: false, status: 404 });
  });
});
