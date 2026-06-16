// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_components/CampaignCard`
 * Purpose: Read-only presentation of one growth campaign — title, lifecycle
 *   status, independent engagement KPI (score vs target), and the
 *   broadcast/snapshot ground-truth that produced it. The whole card links to
 *   the campaign detail page.
 * Scope: Pure presentation. Receives a `CampaignLensRow`; no fetching, no I/O.
 * Invariants: READ_ONLY; renders the KPI the facade computed — never recomputes.
 * Side-effects: none
 * Links: ../[campaignId]/page.tsx, app/src/app/_facades/growth/campaigns.server.ts
 * @internal
 */

import Link from "next/link";
import type { ReactElement } from "react";

import { Card, CardContent, CardHeader, CardTitle, Progress } from "@/components";

import type { CampaignLensRow } from "../_api/fetchCampaigns";
import { CampaignStatusBadge } from "./CampaignStatus";

function basisLabel(basis: CampaignLensRow["basis"]): string {
  switch (basis) {
    case "impressions":
      return "engagement rate";
    case "followers":
      return "engagement / follower";
    default:
      return "no metrics yet";
  }
}

export function CampaignCard({ row }: { row: CampaignLensRow }): ReactElement {
  const targetPct =
    row.targetRate !== null ? `${(row.targetRate * 100).toFixed(2)}%` : "—";
  const observedPct = `${(row.observedRate * 100).toFixed(2)}%`;

  return (
    <Link
      href={`/growth/${row.campaignId}`}
      aria-label={`Open campaign ${row.title}`}
      className="group block rounded-xl focus:outline-none"
    >
      <Card className="h-full transition-colors group-hover:border-primary/50 group-focus-visible:border-primary/50">
        <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{row.title}</CardTitle>
            <p className="truncate text-muted-foreground text-xs">
              {row.campaignId}
            </p>
          </div>
          <CampaignStatusBadge row={row} />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <span className="font-semibold text-2xl tabular-nums tracking-tight">
              {row.score0to100}
              <span className="text-base text-muted-foreground">/100</span>
            </span>
            <span className="text-muted-foreground text-xs">
              {observedPct} vs {targetPct} target
            </span>
          </div>

          <Progress value={row.score0to100} aria-label="KPI score vs target" />

          <dl className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <dt className="text-muted-foreground">Basis</dt>
              <dd className="font-medium">{basisLabel(row.basis)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Posts</dt>
              <dd className="font-medium tabular-nums">
                {row.postedBroadcasts}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Snapshots</dt>
              <dd className="font-medium tabular-nums">{row.snapshotCount}</dd>
            </div>
          </dl>

          <div className="flex flex-wrap items-center justify-between gap-1 border-border/60 border-t pt-2 text-muted-foreground text-xs">
            <span>
              Confidence:{" "}
              <span className="font-medium text-foreground tabular-nums">
                {row.confidencePct ?? "—"}
                {row.confidencePct !== null ? "%" : ""}
              </span>
            </span>
            {row.evaluateAt && (
              <span>
                Resolves {new Date(row.evaluateAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
