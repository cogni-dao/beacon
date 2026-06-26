// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/app/api/connections-metrics-readcost`
 * Purpose: Guard the read-cost boundary at the route — the place that protects
 *   EVERY caller (card, cron, agent), not just the UI. A plain GET serves the
 *   cached snapshot with zero platform calls; only `?refresh=1` resolves the
 *   connection and reads X; 402/403/429 trips the circuit-breaker and serves the
 *   last snapshot without re-calling.
 * Scope: Unit test for app/api/v1/connections/[provider]/metrics/route.ts (GET).
 * Invariants:
 *   - NO_CALL_ON_PASSIVE_READ — plain GET never resolves creds or reads the adapter.
 *   - CIRCUIT_BREAK — 402 marks needs_billing; a cooldown row is never re-called.
 * Side-effects: none (broker + adapter + auth fully mocked)
 * Links: src/app/api/v1/connections/[provider]/metrics/route.ts
 * @internal
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerSessionUser = vi.fn();
const getOrCreateBillingAccountForUser = vi.fn();
const getContainer = vi.fn();

vi.mock("@/lib/auth/server", () => ({
  getServerSessionUser: () => getServerSessionUser(),
}));
vi.mock("@/lib/auth/mapping", () => ({
  getOrCreateBillingAccountForUser: (...args: unknown[]) =>
    getOrCreateBillingAccountForUser(...args),
}));
vi.mock("@/bootstrap/container", () => ({
  getContainer: () => getContainer(),
}));
vi.mock("@/shared/observability", () => ({
  makeLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { GET } from "@/app/api/v1/connections/[provider]/metrics/route";

const SNAPSHOT = {
  profile: { externalAccountId: "1", handle: "@me", displayName: "Me", followers: 7 },
  recentPosts: [],
  fetchedAt: "2026-06-19T00:00:00.000Z",
};

type BrokerMock = {
  getReadState: ReturnType<typeof vi.fn>;
  resolveActive: ReturnType<typeof vi.fn>;
  recordRead: ReturnType<typeof vi.fn>;
};
type InsightsMock = { readAccountMetrics: ReturnType<typeof vi.fn> };

function wire(broker: BrokerMock, insights: InsightsMock) {
  getServerSessionUser.mockResolvedValue({ id: "user-1" });
  getOrCreateBillingAccountForUser.mockResolvedValue({ id: "ba-1" });
  getContainer.mockReturnValue({
    connectionBroker: broker,
    accountsForUser: () => ({}),
    xInsightsForToken: () => insights,
  });
}

const call = (refresh: boolean) =>
  GET(
    new Request(
      `http://t/api/v1/connections/x/metrics${refresh ? "?refresh=1" : ""}`
    ),
    { params: Promise.resolve({ provider: "x" }) }
  );

describe("GET /connections/x/metrics — read-cost boundary", () => {
  let broker: BrokerMock;
  let insights: InsightsMock;

  beforeEach(() => {
    vi.clearAllMocks();
    broker = {
      getReadState: vi.fn(),
      resolveActive: vi.fn(),
      recordRead: vi.fn(),
    };
    insights = { readAccountMetrics: vi.fn() };
    wire(broker, insights);
  });

  it("passive GET serves the cached snapshot with ZERO platform calls", async () => {
    broker.getReadState.mockResolvedValue({
      connectionId: "c1",
      status: "active",
      snapshot: SNAPSHOT,
      fetchedAt: new Date(),
    });

    const res = await call(false);
    const body = await res.json();

    expect(body).toMatchObject({ linked: true, status: "active", metrics: SNAPSHOT });
    expect(broker.resolveActive).not.toHaveBeenCalled();
    expect(insights.readAccountMetrics).not.toHaveBeenCalled();
    expect(broker.recordRead).not.toHaveBeenCalled();
  });

  it("?refresh=1 on a healthy connection reads X once and persists the snapshot", async () => {
    broker.getReadState.mockResolvedValue({
      connectionId: "c1",
      status: "active",
      snapshot: null,
      fetchedAt: null,
    });
    broker.resolveActive.mockResolvedValue({
      connectionId: "c1",
      credentials: { accessToken: "tok" },
    });
    insights.readAccountMetrics.mockResolvedValue(SNAPSHOT);

    const res = await call(true);
    const body = await res.json();

    expect(insights.readAccountMetrics).toHaveBeenCalledTimes(1);
    expect(broker.recordRead).toHaveBeenCalledWith(
      "c1",
      { snapshot: SNAPSHOT, status: "active" },
      expect.anything()
    );
    expect(body).toMatchObject({ linked: true, status: "active", metrics: SNAPSHOT });
  });

  it("?refresh=1 on a circuit-broken connection serves snapshot, never calls X", async () => {
    broker.getReadState.mockResolvedValue({
      connectionId: "c1",
      status: "needs_billing",
      snapshot: SNAPSHOT,
      fetchedAt: new Date(),
    });

    const res = await call(true);
    const body = await res.json();

    expect(broker.resolveActive).not.toHaveBeenCalled();
    expect(insights.readAccountMetrics).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      linked: true,
      status: "needs_billing",
      metrics: SNAPSHOT,
      stale: true,
    });
  });

  it("a 402 from X trips the breaker (needs_billing) and serves the last snapshot", async () => {
    broker.getReadState.mockResolvedValue({
      connectionId: "c1",
      status: "active",
      snapshot: SNAPSHOT,
      fetchedAt: new Date(),
    });
    broker.resolveActive.mockResolvedValue({
      connectionId: "c1",
      credentials: { accessToken: "tok" },
    });
    insights.readAccountMetrics.mockRejectedValue(
      Object.assign(new Error("Request failed with code 402"), { code: 402 })
    );

    const res = await call(true);
    const body = await res.json();

    expect(broker.recordRead).toHaveBeenCalledWith(
      "c1",
      { status: "needs_billing" },
      expect.anything()
    );
    expect(body).toMatchObject({
      linked: true,
      status: "needs_billing",
      metrics: SNAPSHOT,
      stale: true,
    });
  });

  it("returns linked:false when the tenant has no connection", async () => {
    broker.getReadState.mockResolvedValue(null);
    const res = await call(false);
    const body = await res.json();
    expect(body).toEqual({ linked: false });
    expect(insights.readAccountMetrics).not.toHaveBeenCalled();
  });
});
