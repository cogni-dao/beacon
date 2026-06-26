// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_components/PlatformAccountMetrics`
 * Purpose: Growth dashboard module for linked platform account metrics.
 * Scope: Client presentation + React Query fetches against connection
 *   status/metrics routes. Does not own auth linking or platform adapter reads.
 * Invariants:
 *   - NO_PAID_PLATFORM_READ_ON_RENDER: the initial metrics request is the
 *     route-cached snapshot; only the visible Refresh action calls `?refresh=1`.
 *   - ROUTE_IS_COST_BOUNDARY: `/api/v1/connections/[provider]/metrics` decides
 *     cache/circuit-break semantics for every caller.
 *   - PROFILE_LINKING_ONLY: profile owns connect/disconnect; this module only
 *     summarizes growth metrics.
 * Side-effects: IO (cheap status/snapshot reads on mount; explicit metrics refresh on user action).
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
import { cn } from "@cogni/node-ui-kit/util/cn";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, ChevronDown, RefreshCw } from "lucide-react";
import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";

import { Badge } from "@/components/kit/data-display/Badge";
import { XIcon } from "@/components/kit/data-display/ProviderIcons";
import { Button } from "@/components/kit/inputs/Button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/kit/layout/Card";

type ConnectionStatus = "active" | "needs_billing" | "rate_limited" | string;
type ImplementedProvider = "x" | "moltbook";

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
}: {
  connected: boolean;
  status: ConnectionStatus | undefined;
}): string {
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

function MetricTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: number | string;
  detail?: string | undefined;
}): ReactElement {
  return (
    <div className="rounded-md border bg-card px-3 py-2.5">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-1 font-semibold text-base tabular-nums">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      {detail && (
        <div className="mt-1 text-muted-foreground text-xs">{detail}</div>
      )}
    </div>
  );
}

function AccountPanel({
  label,
  Icon,
  handle,
  status,
  children,
  defaultExpanded = false,
}: {
  label: string;
  Icon: (props: { className?: string }) => ReactNode;
  handle: string;
  status: string;
  children?: ReactNode;
  defaultExpanded?: boolean;
}): ReactElement {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const expandable = children != null;

  return (
    <div className="border-border border-t first:border-t-0">
      <button
        type="button"
        className={cn(
          "grid w-full grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-3 text-left",
          expandable && "hover:bg-muted/30"
        )}
        disabled={!expandable}
        aria-expanded={expandable ? expanded : undefined}
        onClick={expandable ? () => setExpanded((next) => !next) : undefined}
      >
        <span className="flex size-8 items-center justify-center rounded-md border bg-background">
          <Icon className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block font-medium text-sm">{label}</span>
          <span className="block truncate text-muted-foreground text-xs">
            {handle}
          </span>
        </span>
        <Badge intent={statusIntent(status)} size="sm">
          {status}
        </Badge>
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            expanded && "rotate-180",
            !expandable && "opacity-0"
          )}
          aria-hidden="true"
        />
      </button>
      {expanded && children != null && (
        <div className="border-border border-t bg-muted/10 px-4 py-4">
          {children}
        </div>
      )}
    </div>
  );
}

function XMetricsDetail({
  connected,
  snapshot,
  refreshError,
  status,
}: {
  connected: boolean;
  snapshot: PlatformAccountSnapshot | null;
  refreshError: boolean;
  status: ConnectionStatus | undefined;
}): ReactElement {
  const chartData = postsChartData(snapshot);

  if (!connected) {
    return (
      <p className="text-muted-foreground text-sm">
        Connect X from{" "}
        <Link href="/profile" className="underline">
          Profile
        </Link>{" "}
        to enable account metrics.
      </p>
    );
  }

  if (status === "needs_billing") {
    return (
      <p className="text-destructive text-sm">
        X reads are paused because the app needs credits. The last stored
        snapshot will remain visible when one exists.
      </p>
    );
  }

  if (status === "rate_limited") {
    return (
      <p className="text-destructive text-sm">
        X reads are paused by the server circuit breaker until the account is
        re-armed.
      </p>
    );
  }

  if (!snapshot) {
    return (
      <p className="text-muted-foreground text-sm">
        No stored X snapshot yet. Refresh will read X once and cache the result
        on the server.
      </p>
    );
  }

  const rate = engagementRate(snapshot);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="space-y-3">
        {refreshError && (
          <p className="text-destructive text-sm">
            Refresh failed; showing the last snapshot returned by the route.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricTile label="Followers" value={snapshot.profile.followers} />
          <MetricTile label="Posts read" value={snapshot.recentPosts.length} />
          <MetricTile label="Engagement" value={engagementTotal(snapshot)} />
          <MetricTile
            label="KPI"
            value={rate == null ? "-" : `${(rate * 100).toFixed(2)}%`}
          />
        </div>
        {snapshot.recentPosts.length > 0 && (
          <ul className="space-y-2">
            {snapshot.recentPosts.slice(0, 3).map((post) => (
              <li
                key={post.externalId}
                className="rounded-md border bg-card p-3"
              >
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
        )}
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

  const xConnected = xStatusQuery.data?.connected ?? false;
  const moltbookConnected = moltbookStatusQuery.data?.connected ?? false;

  const xMetricsQuery = useQuery<MetricsResponse, Error>({
    queryKey: ["platform-account-metrics", "x"],
    queryFn: () => fetchXMetrics(false),
    enabled: xConnected,
    staleTime: 30_000,
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
  const xHandle =
    xSnapshot?.profile.handle ?? xStatusQuery.data?.accounts[0]?.handle;
  const moltbookHandle = moltbookStatusQuery.data?.accounts[0]?.handle;
  const xLabel = statusLabel({ connected: xConnected, status: xStatus });
  const moltbookLabel = statusLabel({
    connected: moltbookConnected,
    status: moltbookStatusQuery.data?.accounts[0]?.status,
  });
  const liveAccountCount = Number(xConnected) + Number(moltbookConnected);
  const totalFollowers = xSnapshot?.profile.followers ?? 0;
  const totalEngagement = engagementTotal(xSnapshot);
  const rate = engagementRate(xSnapshot);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
            Account metrics
          </h2>
          <p className="text-muted-foreground text-sm">
            Cached channel health for the growth loop.
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
        <MetricTile
          label="Core KPI"
          value={rate == null ? "-" : `${(rate * 100).toFixed(2)}%`}
          detail={
            xSnapshot
              ? `Updated ${formatRelativeTime(xSnapshot.fetchedAt)}`
              : undefined
          }
        />
      </div>

      <Card>
        <CardHeader className="px-4 py-3">
          <CardTitle className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
            Accounts
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <AccountPanel
            label="X"
            Icon={XIcon}
            handle={xHandle ?? (xConnected ? "Linked" : "Not linked")}
            status={xLabel}
            defaultExpanded
          >
            <XMetricsDetail
              connected={xConnected}
              snapshot={xSnapshot}
              status={xStatus}
              refreshError={
                refreshXMetrics.isError || !!xMetricsQuery.data?.error
              }
            />
          </AccountPanel>
          <AccountPanel
            label="Moltbook"
            Icon={BookOpen}
            handle={
              moltbookHandle ?? (moltbookConnected ? "Linked" : "Not linked")
            }
            status={moltbookLabel}
          />
        </CardContent>
      </Card>
    </section>
  );
}
