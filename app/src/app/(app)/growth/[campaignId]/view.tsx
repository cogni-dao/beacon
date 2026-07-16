// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/[campaignId]/view`
 * Purpose: Campaign detail — the brief/goal, a minimal control panel (status + delete
 *   + cadence), and the pipeline BOARD: a Kanban whose columns are the growth loop
 *   (Opportunities → Drafts → Ready → Posted, + Rejected), with per-layer KPI as a
 *   header strip and the loop's AI-triggers (capture/research/generate) attached to
 *   the columns they advance. Replaces the old funnel-grouped list + detached actions.
 * Scope: Pure presentation. Receives a `CampaignDetail`; no fetching (the board owns
 *   the client mutations).
 * Invariants:
 *   - READ_ONLY_KPI / PER_LAYER_KPI: the board renders the facade-computed per-layer
 *     KPI — never recomputes, never blends.
 *   - STATUS_TOGGLE_REAL: the draft↔active toggle + delete are WIRED (PATCH/DELETE);
 *     status only persists the field — schedule pause/resume is the heartbeat PR.
 * Side-effects: none
 * Links: ./page.tsx, ../_components/CampaignBoard.tsx, ../_components/CampaignStatus.tsx,
 *   ../_components/CampaignControls.tsx
 * @internal
 */

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactElement } from "react";

import { Card, CardContent } from "@/components";
import type { CampaignDetail } from "@/app/_facades/growth/campaigns.server";

import { CampaignBoard } from "../_components/CampaignBoard";
import { CampaignControls } from "../_components/CampaignControls";
import {
  campaignStatusInfo,
  CampaignStatusBadge,
} from "../_components/CampaignStatus";

function Stat({ label, value }: { label: string; value: string }): ReactElement {
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
  const status = campaignStatusInfo(campaign.status);
  // Cadence is a static display in v0 — the real schedule lands in the heartbeat PR.
  const cadenceLabel = campaign.status === "active" ? "1/day" : "paused";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-5 md:p-6">
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
        <CampaignStatusBadge status={campaign.status} />
      </div>

      {/* Control panel — status toggle + delete are WIRED (PATCH/DELETE). The
          toggle only persists `status`; status→Temporal schedule pause/resume
          (and trigger toggles) are the heartbeat PR. The loop's per-stage triggers
          (capture/research/generate) now live on the board columns below. */}
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <dl className="flex flex-wrap gap-6">
              <Stat label="Status" value={status.label} />
              <Stat label="Cadence" value={cadenceLabel} />
              <Stat label="Ingest" value="every 30m" />
            </dl>
            <CampaignControls
              campaignId={campaign.campaignId}
              status={campaign.status}
            />
          </div>
          {/* Honesty: "Activate" only persists status today — it does NOT auto-run
              the loop. The autonomous driver (heartbeat → research/generate/post on
              active campaigns) is a later PR. Until then, advance the loop from the
              board's column triggers. */}
          <p className="text-muted-foreground text-xs">
            Activating marks intent only &mdash; it does not auto-run yet (autonomous
            heartbeat is a later PR). Advance the loop from the board below.
          </p>
          <p className="whitespace-pre-wrap text-muted-foreground text-sm leading-relaxed">
            {campaign.brief}
          </p>
        </CardContent>
      </Card>

      {/* The pipeline board: columns = the loop stages, per-layer KPI strip on top,
          capture/research/generate triggers on the columns they advance. */}
      <CampaignBoard campaign={campaign} />
    </div>
  );
}
