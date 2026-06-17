// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_components/FunnelLayerSection`
 * Purpose: Render one funnel layer (TOFU/MOFU/BOFU) of a campaign's classified
 *   content queue — the layer's independent KPI (score vs target) plus the posts
 *   classified to it, each showing channel · status · metric.
 * Scope: Pure presentation. Receives the facade-computed per-layer KPI + filtered
 *   posts; no fetching, no recomputation.
 * Invariants: READ_ONLY; renders the per-layer KPI the facade computed.
 * Side-effects: none
 * Links: ../[campaignId]/view.tsx, app/src/app/_facades/growth/campaigns.server.ts
 * @internal
 */

import type { ReactElement } from "react";

import { Card, CardContent, Progress } from "@/components";
import type {
  CampaignPost,
  FunnelLayer,
  FunnelLayerKpi,
} from "@/app/_facades/growth/campaigns.server";

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
  layer,
  kpi,
  targetRate,
  posts,
}: {
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
          No {meta.label} posts yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {posts.map((post) => (
            <li key={post.id}>
              <Card>
                <CardContent className="flex flex-col gap-2 pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground text-xs">
                    <span className="flex items-center gap-2">
                      <span className="font-medium text-foreground uppercase">
                        {post.channel}
                      </span>
                      {post.topic && (
                        <span className="rounded bg-muted px-1.5 py-0.5">
                          {post.topic}
                        </span>
                      )}
                    </span>
                    <span>{post.status}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {post.text}
                  </p>
                  <div className="flex flex-wrap gap-4 border-border/60 border-t pt-2 text-muted-foreground text-xs tabular-nums">
                    <span>{post.impressions ?? "—"} impressions</span>
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
    </section>
  );
}
