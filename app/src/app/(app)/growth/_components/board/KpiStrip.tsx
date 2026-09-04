// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_components/board/KpiStrip`
 * Purpose: The MEASURE glance above the pipeline board — each funnel layer's
 *   independent KPI (score/100 + observed vs target) as a compact tile. The per-layer
 *   scores that used to divide the queue into lanes now live here as a header strip,
 *   freeing the board columns to express the loop STAGE instead of the funnel layer.
 * Scope: Pure presentation. Renders the facade-computed KPI; never recomputes.
 * Invariants:
 *   - READ_ONLY_KPI / PER_LAYER_KPI: renders each layer's facade value independently.
 * Side-effects: none
 * Links: ../CampaignBoard.tsx, @/app/_facades/growth/campaigns.server (layers)
 * @internal
 */

import type { ReactElement } from "react";

import { Progress } from "@/components";
import type { CampaignDetail } from "@/app/_facades/growth/campaigns.server";
import { FUNNEL_LAYERS } from "@/app/_facades/growth/campaigns.shared";

const LAYER_ROLE: Readonly<Record<string, string>> = {
  tofu: "awareness",
  mofu: "consideration",
  bofu: "action",
};

export function KpiStrip({
  campaign,
}: {
  campaign: CampaignDetail;
}): ReactElement {
  const targetPct =
    campaign.targetRate !== null
      ? `${(campaign.targetRate * 100).toFixed(2)}%`
      : "—";

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {FUNNEL_LAYERS.map((layer) => {
        const kpi = campaign.layers[layer];
        const observedPct = `${(kpi.observedRate * 100).toFixed(2)}%`;
        return (
          <div
            key={layer}
            className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold text-sm uppercase">{layer}</span>
              <span className="text-muted-foreground text-xs">
                {LAYER_ROLE[layer]}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-lg tabular-nums tracking-tight">
                {kpi.score0to100}
                <span className="text-muted-foreground text-xs">/100</span>
              </span>
              <Progress
                value={kpi.score0to100}
                aria-label={`${layer.toUpperCase()} KPI score vs target`}
              />
            </div>
            <span className="text-muted-foreground text-xs tabular-nums">
              {observedPct} vs {targetPct} target
            </span>
          </div>
        );
      })}
    </div>
  );
}
