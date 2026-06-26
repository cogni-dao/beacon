// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_components/PlatformAccountMetrics`
 * Purpose: Growth dashboard module for expandable platform account metrics
 *   across X, Moltbook, and future channels.
 * Scope: Client presentation + React Query fetches against connection
 *   status/metrics routes. Does not own auth linking or platform adapter reads.
 * Invariants:
 *   - NO_PLATFORM_READ_ON_RENDER: metrics queries are disabled on mount; the
 *     visible Refresh button is the only UI path to `?refresh=1`.
 *   - ROUTE_IS_COST_BOUNDARY: `/api/v1/connections/[provider]/metrics` decides
 *     cache/circuit-break semantics for every caller.
 *   - PROFILE_LINKING_ONLY: profile owns connect/disconnect; this module only
 *     summarizes growth metrics.
 * Side-effects: IO (cheap status reads on mount; explicit metrics refresh on user action).
 * Links: src/app/api/v1/connections/[provider]/metrics/route.ts, docs/spec/platform-connections.md
 * @internal
 */

"use client";

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@cogni/node-ui-kit/shadcn/chart";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  BookOpen,
  Globe2,
  RefreshCw,
  Video,
} from "lucide-react";
import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";

import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@cogni/node-ui-kit/shadcn/table";
import { Badge } from "@/components/kit/data-display/Badge";
import { ExpandableTableRow } from "@/components/kit/data-display/ExpandableTableRow";
import { XIcon } from "@/components/kit/data-display/ProviderIcons";
import { Button } from "@/components/kit/inputs/Button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/kit/layout/Card";

type ConnectionStatus = "active" | "needs_billing" | "rate_limited" | string;

interface ConnectionStatusResponse {
  connected: boolean;
  accounts: Array<{
    handle: string | null;
    displayLabel?: string | null;
    status?: ConnectionStatus;
  }>;
}

interface PlatformPostMetrics {
  externalId: string;
  text: string;
  createdAt: string;
  likes: number;
  reposts: number;
  replies: number;
  impressions?: number;
}

interface PlatformAccountSnapshot {
  profile: {
    externalAccountId: string;
    handle: string;
    displayName: string;
    followers: number;
    following?: number;
    postCount?: number;
    avatarUrl?: string;
  };
  recentPosts: PlatformPostMetrics[];
  fetchedAt: string;
}

interface MetricsResponse {
  linked: boolean;
  status?: ConnectionStatus;
  metrics?: PlatformAccountSnapshot | null;
  stale?: boolean;
  error?: string;
}

type ImplementedProvider = "x" | "moltbook";

interface PlatformRow {
  id: ImplementedProvider | "meta" | "youtube" | "blog";
  label: string;
  Icon: (props: { className?: string }) => ReactNode;
  enabled: boolean;
  metricsEnabled: boolean;
  statusProvider?: ImplementedProvider;
}

const PLATFORMS: readonly PlatformRow[] = [
  {
    id: "x",
    label: "X",
    Icon: XIcon,
    enabled: true,
    metricsEnabled: true,
    statusProvider: "x",
  },
  {
    id: "moltbook",
    label: "Moltbook",
    Icon: BookOpen,
    enabled: true,
    metricsEnabled: false,
    statusProvider: "moltbook",
  },
  {
    id: "meta",
    label: "Meta",
    Icon: BarChart3,
    enabled: false,
    metricsEnabled: false,
  },
  {
    id: "youtube",
    label: "YouTube",
    Icon: Video,
    enabled: false,
    metricsEnabled: false,
  },
  {
    id: "blog",
    label: "Blog / SEO",
    Icon: Globe2,
    enabled: false,
    metricsEnabled: false,
  },
];

const chartConfig = {
  likes: { label: "Likes", color: "hsl(var(--chart-1))" },
  reposts: { label: "Reposts", color: "hsl(var(--chart-2))" },
  replies: { label: "Replies", color: "hsl(var(--chart-3))" },
} satisfies ChartConfig;

async function fetchConnectionStatus(
  provider: ImplementedProvider
): Promise<ConnectionStatusResponse> {
  const res = await fetch(`/api/v1/connections/${provider}/status`);
  if (!res.ok) return { connected: false, accounts: [] };
  return res.json();
}

async function fetchXMetrics(refresh: boolean): Promise<MetricsResponse> {
  const res = await fetch(
    `/api/v1/connections/x/metrics${refresh ? "?refresh=1" : ""}`
  );
  const body = (await res.json().catch(() => null)) as MetricsResponse | null;
  if (body) return body;
  if (!res.ok) throw new Error(`x metrics read failed (${res.status})`);
  return { linked: false };
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatNumber(value: number | null | undefined): string {
  return typeof value === "number" ? value.toLocaleString() : "—";
}

function engagementTotal(snapshot: PlatformAccountSnapshot | null): number {
  return (
    snapshot?.recentPosts.reduce(
      (sum, post) => sum + post.likes + post.reposts + post.replies,
      0
    ) ?? 0
  );
}

function engagementRate(snapshot: PlatformAccountSnapshot | null): number | null {
  if (!snapshot) return null;
  const impressions = snapshot.recentPosts.reduce(
    (sum, post) => sum + (post.impressions ?? 0),
    0
  );
  if (impressions > 0) return engagementTotal(snapshot) / impressions;
  if (snapshot.profile.followers > 0) {
    return engagementTotal(snapshot) / snapshot.profile.followers;
  }
  return null;
}

function statusLabel({
  connected,
  status,
  enabled,
}: {
  connected: boolean;
  status: ConnectionStatus | undefined;
  enabled: boolean;
}): string {
  if (!enabled) return "vNext";
  if (!connected) return "Not connected";
  if (status === "needs_billing") return "Needs credits";
  if (status === "rate_limited") return "Rate limited";
  return "Connected";
}

function statusIntent(status: string): "destructive" | "default" | "secondary" {
  if (status === "Needs credits" || status === "Rate limited") {
    return "destructive";
  }
  if (status === "Connected") return "default";
  return "secondary";
}

function postsChartData(snapshot: PlatformAccountSnapshot | null) {
  return (snapshot?.recentPosts ?? []).slice(0, 8).map((post, i) => ({
    label: `P${i + 1}`,
    likes: post.likes,
    reposts: post.reposts,
    replies: post.replies,
  }));
}

function PlatformMetricsDetail({
  snapshot,
  refreshError,
  status,
}: {
  snapshot: PlatformAccountSnapshot | null;
  refreshError: boolean;
  status: ConnectionStatus | undefined;
}): ReactElement {
  const chartData = postsChartData(snapshot);

  if (status === "needs_billing") {
    return (
      <p className="text-destructive text-sm">
        Platform reads are paused because the app needs credits. The route will
        serve the last stored snapshot once one exists.
      </p>
    );
  }

  if (status === "rate_limited") {
    return (
      <p className="text-destructive text-sm">
        Platform reads are paused by the server circuit breaker until the
        account is re-armed.
      </p>
    );
  }

  if (!snapshot) {
    return (
      <p className="text-muted-foreground text-sm">
        No stored metrics snapshot yet. The row stays visible so the next manual
        refresh has an obvious target.
      </p>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="space-y-3">
        {refreshError && (
          <p className="text-destructive text-sm">
            Refresh failed; showing the last data returned by the route.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricTile label="Followers" value={snapshot.profile.followers} />
          <MetricTile label="Posts read" value={snapshot.recentPosts.length} />
          <MetricTile label="Engagement" value={engagementTotal(snapshot)} />
          <MetricTile
            label="KPI"
            value={
              engagementRate(snapshot) == null
                ? "—"
                : `${(engagementRate(snapshot)! * 100).toFixed(2)}%`
            }
          />
        </div>
        <ul className="space-y-2">
          {snapshot.recentPosts.slice(0, 3).map((post) => (
            <li key={post.externalId} className="rounded-md border p-3">
              <p className="line-clamp-2 text-sm">{post.text}</p>
              <div className="mt-2 flex flex-wrap gap-4 text-muted-foreground text-xs tabular-nums">
                <span>{post.likes.toLocaleString()} likes</span>
                <span>{post.reposts.toLocaleString()} reposts</span>
                <span>{post.replies.toLocaleString()} replies</span>
                {typeof post.impressions === "number" && (
                  <span>{post.impressions.toLocaleString()} impressions</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
      {chartData.length > 0 && (
        <ChartContainer config={chartConfig} className="h-48 w-full">
          <BarChart data={chartData} barCategoryGap="16%" barSize={16}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent indicator="dot" />}
            />
            <Bar dataKey="likes" stackId="a" fill="var(--color-likes)" />
            <Bar dataKey="reposts" stackId="a" fill="var(--color-reposts)" />
            <Bar
              dataKey="replies"
              stackId="a"
              fill="var(--color-replies)"
              radius={[2, 2, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
      )}
    </div>
  );
}

function MetricTile({
  label,
  value,
}: {
  label: string;
  value: number | string;
}): ReactElement {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="font-semibold text-sm tabular-nums">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
    </div>
  );
}

export function PlatformAccountMetrics(): ReactElement {
  const queryClient = useQueryClient();

  const xStatusQuery = useQuery({
    queryKey: ["connection-status", "x"],
    queryFn: () => fetchConnectionStatus("x"),
    staleTime: 30_000,
  });
  const moltbookStatusQuery = useQuery({
    queryKey: ["connection-status", "moltbook"],
    queryFn: () => fetchConnectionStatus("moltbook"),
    staleTime: 30_000,
  });

  const xMetricsQuery = useQuery<MetricsResponse, Error>({
    queryKey: ["platform-account-metrics", "x"],
    queryFn: () => fetchXMetrics(false),
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });

  const refreshXMetrics = useMutation({
    mutationFn: () => fetchXMetrics(true),
    onSuccess: (data) => {
      queryClient.setQueryData(["platform-account-metrics", "x"], data);
      void queryClient.invalidateQueries({
        queryKey: ["connection-status", "x"],
      });
    },
  });

  const xStatus =
    xMetricsQuery.data?.status ?? xStatusQuery.data?.accounts[0]?.status;
  const xSnapshot = xMetricsQuery.data?.metrics ?? null;
  const xConnected = xStatusQuery.data?.connected ?? false;
  const moltbookConnected = moltbookStatusQuery.data?.connected ?? false;
  const liveAccountCount = Number(xConnected) + Number(moltbookConnected);
  const totalFollowers = xSnapshot?.profile.followers ?? 0;
  const totalEngagement = engagementTotal(xSnapshot);
  const rate = engagementRate(xSnapshot);
  const kpiLabel = rate == null ? "No KPI yet" : `${(rate * 100).toFixed(2)}%`;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
            Platform account metrics
          </h2>
          <p className="text-muted-foreground text-sm">
            Growth-facing account totals and expandable per-platform snapshots.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={
            refreshXMetrics.isPending ||
            !xConnected ||
            xStatus === "needs_billing" ||
            xStatus === "rate_limited"
          }
          onClick={() => refreshXMetrics.mutate()}
        >
          <RefreshCw
            className={refreshXMetrics.isPending ? "animate-spin" : undefined}
            aria-hidden="true"
          />
          Refresh
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <MetricTile label="Live accounts" value={`${liveAccountCount}/2`} />
        <MetricTile label="Followers" value={totalFollowers} />
        <MetricTile label="Engagement" value={totalEngagement} />
        <MetricTile label="Core KPI" value={kpiLabel} />
      </div>

      <Card>
        <CardHeader className="px-5 py-3">
          <CardTitle className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
            My accounts
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Account</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Followers</TableHead>
                <TableHead className="text-right">Engagement</TableHead>
                <TableHead className="text-right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {PLATFORMS.map((platform) => {
                const statusData =
                  platform.statusProvider === "x"
                    ? xStatusQuery.data
                    : platform.statusProvider === "moltbook"
                      ? moltbookStatusQuery.data
                      : undefined;
                const connected = statusData?.connected ?? false;
                const account = statusData?.accounts[0] ?? null;
                const effectiveStatus =
                  platform.id === "x"
                    ? (xMetricsQuery.data?.status ?? account?.status)
                    : account?.status;
                const label = statusLabel({
                  connected,
                  status: effectiveStatus,
                  enabled: platform.enabled,
                });
                const handle =
                  platform.id === "x"
                    ? (xSnapshot?.profile.handle ?? account?.handle)
                    : account?.handle;
                const platformSnapshot = platform.id === "x" ? xSnapshot : null;
                const disabledDetail =
                  !platform.enabled ||
                  (platform.enabled && !platform.metricsEnabled);

                return (
                  <ExpandableTableRow
                    key={platform.id}
                    colSpan={6}
                    defaultExpanded={platform.id === "x"}
                    cellClassNames={[
                      undefined,
                      undefined,
                      "text-right",
                      "text-right",
                      "text-right",
                    ]}
                    expandedContent={
                      disabledDetail ? (
                        <p className="text-muted-foreground text-sm">
                          {platform.enabled
                            ? "Connection status is wired; metrics snapshots for this platform are next."
                            : "Planned platform. It will use the same status, snapshot, refresh, and circuit-break shape."}
                        </p>
                      ) : (
                        <PlatformMetricsDetail
                          snapshot={platformSnapshot}
                          status={effectiveStatus}
                          refreshError={
                            refreshXMetrics.isError ||
                            !!xMetricsQuery.data?.error
                          }
                        />
                      )
                    }
                    cells={[
                      <span
                        key="account"
                        className="flex min-w-0 items-center gap-2"
                      >
                        <platform.Icon className="size-4 shrink-0" />
                        <span className="min-w-0">
                          <span className="block font-medium text-sm">
                            {platform.label}
                          </span>
                          <span className="block truncate text-muted-foreground text-xs">
                            {handle ?? (connected ? "Connected" : "Not linked")}
                          </span>
                        </span>
                      </span>,
                      <Badge key="status" intent={statusIntent(label)} size="sm">
                        {label}
                      </Badge>,
                      <span key="followers" className="tabular-nums">
                        {formatNumber(platformSnapshot?.profile.followers)}
                      </span>,
                      <span key="engagement" className="tabular-nums">
                        {platformSnapshot
                          ? engagementTotal(platformSnapshot)
                          : "—"}
                      </span>,
                      <span key="updated" className="text-muted-foreground text-xs">
                        {platformSnapshot
                          ? formatRelativeTime(platformSnapshot.fetchedAt)
                          : "—"}
                      </span>,
                    ]}
                  />
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {!xConnected && (
        <p className="text-muted-foreground text-xs">
          Connect X from{" "}
          <Link href="/profile" className="underline">
            Profile
          </Link>{" "}
          to enable the first real account metrics refresh.
        </p>
      )}
    </section>
  );
}
