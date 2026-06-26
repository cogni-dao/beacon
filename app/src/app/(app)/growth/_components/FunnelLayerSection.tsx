// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_components/FunnelLayerSection`
 * Purpose: Render one funnel layer (TOFU/MOFU/BOFU) of a campaign's classified
 *   content queue — the layer's independent KPI (score vs target) plus the posts
 *   classified to it, each as a REVIEW + REFINE `DraftCard` (state badge + approve/
 *   reject/edit/refine).
 * Scope: Presentation + per-draft action delegation to `DraftCard`. Receives the
 *   facade-computed per-layer KPI + (already status-filtered) posts; no fetching,
 *   no KPI recomputation.
 * Invariants: READ_ONLY_KPI; renders the per-layer KPI the facade computed.
 * Side-effects: none (draft mutations live in `DraftCard`)
 * Links: ../[campaignId]/view.tsx, ./DraftCard.tsx,
 *   app/src/app/_facades/growth/campaigns.server.ts
 * @internal
 */

import type { ReactElement } from "react";

import { Progress } from "@/components";
import type {
  CampaignPost,
  FunnelLayer,
  FunnelLayerKpi,
} from "@/app/_facades/growth/campaigns.server";

import { DraftCard } from "./DraftCard";

/** Human-facing label + one-line role for each funnel layer. */
const LAYER_META: Readonly<
  Record<FunnelLayer, { label: string; role: string }>
> = {
  tofu: { label: "TOFU", role: "awareness" },
  mofu: { label: "MOFU", role: "consideration" },
  bofu: { label: "BOFU", role: "action" },
};

function basisLabel(basis: FunnelLayerKpi["basis"]): string {
  switch (basis) {
    case "impressions":
      return "engagement rate";
    case "followers":
      return "engagement / follower";
    default:
      return "no metrics yet";
  }
}

export function FunnelLayerSection({
  campaignId,
  layer,
  kpi,
  targetRate,
  posts,
}: {
  campaignId: string;
  layer: FunnelLayer;
  kpi: FunnelLayerKpi;
  targetRate: number | null;
  posts: CampaignPost[];
}): ReactElement {
  const meta = LAYER_META[layer];
  const targetPct =
    targetRate !== null ? `${(targetRate * 100).toFixed(2)}%` : "—";
  const observedPct = `${(kpi.observedRate * 100).toFixed(2)}%`;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-sm">
          {meta.label}{" "}
          <span className="font-normal text-muted-foreground">{meta.role}</span>
        </h2>
        <span className="text-muted-foreground text-xs">
          {observedPct} vs {targetPct} target · {basisLabel(kpi.basis)}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <span className="font-semibold text-lg tabular-nums tracking-tight">
          {kpi.score0to100}
          <span className="text-muted-foreground text-xs">/100</span>
        </span>
        <Progress
          value={kpi.score0to100}
          aria-label={`${meta.label} KPI score vs target`}
        />
      </div>

      {posts.length === 0 ? (
        <p className="rounded-lg border border-border border-dashed p-4 text-center text-muted-foreground text-xs">
          No {meta.label} posts in this view.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {posts.map((post) => (
            <li key={post.id}>
              <DraftCard campaignId={campaignId} post={post} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
