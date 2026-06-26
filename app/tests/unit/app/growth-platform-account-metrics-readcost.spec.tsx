// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/app/growth-platform-account-metrics-readcost`
 * Purpose: The Growth platform-account metrics module is visible even when no
 *   snapshot exists, and it never calls the paid refresh path on render.
 * Scope: Unit test for src/app/(app)/growth/_components/PlatformAccountMetrics.tsx.
 * Invariants: INV-READCOST-NO-METRICS-FETCH-ON-RENDER — the visible Refresh
 *   affordance is the only UI path to `/api/v1/connections/x/metrics?refresh=1`;
 *   the route-cached snapshot GET is allowed because it never calls X.
 * Side-effects: none (mocked fetch + chart primitives)
 * Links: src/app/(app)/growth/_components/PlatformAccountMetrics.tsx
 * @vitest-environment jsdom
 * @internal
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("@cogni/node-ui-kit/shadcn/chart", () => ({
  ChartContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="chart">{children}</div>
  ),
  ChartTooltip: () => null,
  ChartTooltipContent: () => null,
}));

vi.mock("recharts", () => ({
  Bar: () => null,
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CartesianGrid: () => null,
  XAxis: () => null,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import { PlatformAccountMetrics } from "@/app/(app)/growth/_components/PlatformAccountMetrics";

const snapshot = (followers: number) => ({
  linked: true,
  status: "active",
  metrics: {
    profile: {
      externalAccountId: "1",
      handle: "@me",
      displayName: "Me",
      followers,
    },
    recentPosts: [
      {
        externalId: "post-1",
        text: "post one",
        createdAt: new Date().toISOString(),
        likes: 8,
        reposts: 2,
        replies: 1,
        impressions: 100,
      },
    ],
    fetchedAt: new Date().toISOString(),
  },
});

function installFetchMock({
  metricsBody = { linked: true, status: "active", metrics: null },
}: {
  metricsBody?: unknown;
} = {}): { calls: string[] } {
  const calls: string[] = [];
  const json = (body: unknown) =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(body),
    } as Response);

  const handler = (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    if (url.endsWith("/api/v1/connections/x/status")) {
      return json({
        connected: true,
        accounts: [{ handle: "@me", status: "active" }],
      });
    }
    if (url.endsWith("/api/v1/connections/moltbook/status")) {
      return json({
        connected: true,
        accounts: [{ handle: "moltbook-agent", status: "active" }],
      });
    }
    if (url.includes("/api/v1/connections/x/metrics")) {
      return json(metricsBody);
    }
    return json({});
  };

  vi.stubGlobal("fetch", vi.fn(handler));
  return { calls };
}

function renderMetrics(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <PlatformAccountMetrics />
    </QueryClientProvider>
  );
}

const metricsCalls = (calls: string[]) =>
  calls.filter((u) => u.includes("/api/v1/connections/x/metrics"));
const paidRefreshCalls = (calls: string[]) =>
  metricsCalls(calls).filter((u) => u.includes("refresh=1"));

describe("Growth platform account metrics — read-cost discipline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the metrics shell and refresh affordance without calling paid refresh on mount", async () => {
    const { calls } = installFetchMock();

    renderMetrics();

    expect(
      screen.getByRole("heading", { name: /account metrics/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(calls.some((u) => u.endsWith("/connections/x/status"))).toBe(true);
    });
    await waitFor(() => {
      expect(metricsCalls(calls)).toEqual(["/api/v1/connections/x/metrics"]);
    });
    expect(
      screen.getByText(/no stored x snapshot yet/i)
    ).toBeInTheDocument();
    expect(paidRefreshCalls(calls)).toHaveLength(0);
  });

  it("hits ?refresh=1 exactly once on explicit refresh", async () => {
    const { calls } = installFetchMock({ metricsBody: snapshot(43) });

    renderMetrics();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /refresh/i })
      ).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

    await waitFor(() => {
      expect(paidRefreshCalls(calls)).toEqual([
        "/api/v1/connections/x/metrics?refresh=1",
      ]);
    });
    await waitFor(() => {
      expect(screen.getAllByText("43").length).toBeGreaterThan(0);
    });
  });
});
