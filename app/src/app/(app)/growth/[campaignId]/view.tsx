// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/[campaignId]/view`
 * Purpose: Read-only campaign detail — the brief/goal, the independent KPI vs
 *   target, and the posts (broadcasts) + their latest cached metrics that the
 *   KPI scored. Makes the loop's evidence chain visible to a human.
 * Scope: Pure presentation. Receives a `CampaignDetail`; no fetching.
 * Invariants: READ_ONLY; renders the facade-computed KPI — never recomputes.
 * Side-effects: none
 * Links: ./page.tsx, ../_components/CampaignStatus.tsx
 * @internal
 */

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactElement } from "react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Progress,
} from "@/components";
import type { CampaignDetail } from "@/app/_facades/growth/campaigns.server";

import { CampaignStatusBadge } from "../_components/CampaignStatus";

function basisLabel(basis: CampaignDetail["basis"]): string {
  switch (basis) {
    case "impressions":
      return "engagement rate";
    case "followers":
      return "engagement / follower";
    default:
      return "no metrics yet";
  }
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string;
}): ReactElement {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium text-sm tabular-nums">{value}</dd>
    </div>
  );
}

export function CampaignDetailView({
  campaign,
}: {
  campaign: CampaignDetail;
}): ReactElement {
  const targetPct =
    campaign.targetRate !== null
      ? `${(campaign.targetRate * 100).toFixed(2)}%`
      : "—";
  const observedPct = `${(campaign.observedRate * 100).toFixed(2)}%`;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-5 md:p-6">
      <Link
        href="/growth"
        className="inline-flex w-fit items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Growth
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="font-semibold text-xl tracking-tight md:text-2xl">
            {campaign.title}
          </h1>
          <p className="text-muted-foreground text-xs">{campaign.campaignId}</p>
        </div>
        <CampaignStatusBadge row={campaign} />
      </div>

      {/* KPI */}
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <div className="flex items-baseline justify-between">
            <span className="font-semibold text-3xl tabular-nums tracking-tight">
              {campaign.score0to100}
              <span className="text-lg text-muted-foreground">/100</span>
            </span>
            <span className="text-muted-foreground text-sm">
              {observedPct} vs {targetPct} target · {basisLabel(campaign.basis)}
            </span>
          </div>
          <Progress
            value={campaign.score0to100}
            aria-label="KPI score vs target"
          />
          <dl className="grid grid-cols-2 gap-3 pt-1 sm:grid-cols-4">
            <Stat
              label="Confidence"
              value={
                campaign.confidencePct !== null
                  ? `${campaign.confidencePct}%`
                  : "—"
              }
            />
            <Stat label="Posts" value={String(campaign.postedBroadcasts)} />
            <Stat label="Snapshots" value={String(campaign.snapshotCount)} />
            <Stat
              label="Resolves"
              value={
                campaign.evaluateAt
                  ? new Date(campaign.evaluateAt).toLocaleDateString()
                  : "—"
              }
            />
          </dl>
        </CardContent>
      </Card>

      {/* Brief */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Brief</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-muted-foreground text-sm leading-relaxed">
            {campaign.brief}
          </p>
        </CardContent>
      </Card>

      {/* Posts */}
      <div className="flex flex-col gap-2">
        <h2 className="font-medium text-sm">Posts ({campaign.posts.length})</h2>
        {campaign.posts.length === 0 ? (
          <div className="rounded-lg border border-border border-dashed p-8 text-center text-muted-foreground text-sm">
            No posts yet — this campaign hasn&rsquo;t generated content.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {campaign.posts.map((post) => (
              <li key={post.id}>
                <Card>
                  <CardContent className="flex flex-col gap-2 pt-4">
                    <div className="flex items-center justify-between gap-2 text-muted-foreground text-xs">
                      <span className="font-medium text-foreground uppercase">
                        {post.channel}
                      </span>
                      <span>{post.status}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">
                      {post.text}
                    </p>
                    <div className="flex flex-wrap gap-4 border-border/60 border-t pt-2 text-muted-foreground text-xs tabular-nums">
                      <span>
                        {post.impressions ?? "—"} impressions
                      </span>
                      <span>{post.likes} likes</span>
                      <span>{post.reposts} reposts</span>
                      <span>{post.replies} replies</span>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
