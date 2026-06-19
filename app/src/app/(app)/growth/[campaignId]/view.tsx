// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/[campaignId]/view`
 * Purpose: Read-only campaign detail — the brief/goal, a minimal control panel
 *   (status + read-only pause/resume + cadence), and the classified content queue
 *   GROUPED BY funnel layer (TOFU/MOFU/BOFU), each section showing its independent
 *   per-layer KPI and the posts + latest cached metrics that scored it.
 * Scope: Pure presentation. Receives a `CampaignDetail`; no fetching.
 * Invariants:
 *   - READ_ONLY_KPI: renders the facade-computed KPI — never recomputes.
 *   - PER_LAYER_KPI: each funnel layer is scored independently (never one blended bar).
 *   - STATUS_TOGGLE_REAL: the draft↔active toggle + delete are WIRED (PATCH/DELETE);
 *     status only persists the field — schedule pause/resume is the heartbeat PR.
 * Side-effects: none
 * Links: ./page.tsx, ../_components/CampaignStatus.tsx, ../_components/CampaignControls.tsx
 * @internal
 */

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactElement } from "react";

import { Card, CardContent } from "@/components";
import type { CampaignDetail } from "@/app/_facades/growth/campaigns.server";
import { FUNNEL_LAYERS } from "@/app/_facades/growth/campaigns.server";

import { CampaignActions } from "../_components/CampaignActions";
import { CampaignChatPanel } from "../_components/CampaignChatPanel";
import { CampaignControls } from "../_components/CampaignControls";
import {
  campaignStatusInfo,
  CampaignStatusBadge,
} from "../_components/CampaignStatus";
import { FunnelLayerSection } from "../_components/FunnelLayerSection";

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
        <CampaignStatusBadge status={campaign.status} />
      </div>

      {/* Control panel — status toggle + delete are WIRED (PATCH/DELETE). The
          toggle only persists `status`; status→Temporal schedule pause/resume
          (and trigger toggles) are the heartbeat PR. */}
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
              active campaigns) is a later PR. Until then, advance the loop manually
              with the actions below. */}
          <p className="text-muted-foreground text-xs">
            Activating marks intent only &mdash; it does not auto-run yet (autonomous
            heartbeat is a later PR). Advance the loop manually here:
          </p>
          <CampaignActions campaignId={campaign.campaignId} />
        </CardContent>
      </Card>

      {/* Brief */}
      <Card>
        <CardContent className="pt-6">
          <h2 className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Brief
          </h2>
          <p className="whitespace-pre-wrap text-muted-foreground text-sm leading-relaxed">
            {campaign.brief}
          </p>
        </CardContent>
      </Card>

      {/* Queue grouped by funnel layer, each with its own independent KPI. */}
      <div className="flex flex-col gap-4">
        {FUNNEL_LAYERS.map((layer) => (
          <FunnelLayerSection
            key={layer}
            layer={layer}
            kpi={campaign.layers[layer]}
            targetRate={campaign.targetRate}
            posts={campaign.posts.filter((p) => p.funnelLayer === layer)}
          />
        ))}
      </div>

      {/* Live AI chat + tool-usage feed — watch the agent research/draft in real
          time instead of staring at a stalled action button. Ephemeral session
          (no thread persistence). */}
      <Card>
        <CardContent className="pt-6">
          <CampaignChatPanel campaignId={campaign.campaignId} />
        </CardContent>
      </Card>
    </div>
  );
}
