// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_components/CampaignFunnel`
 * Purpose: The campaign's draft queue, grouped by funnel layer, with a light
 *   ORGANIZATION control above the lanes: a status filter so the operator can blast
 *   through review — see everything, hide rejected, or focus a single state
 *   (generated / approved / rejected). Each lane renders its posts as review+refine
 *   `DraftCard`s. Defaults to "Active" (hide rejected) so slop stays out of the way.
 * Scope: Client component — owns only the filter selection; delegates per-draft
 *   actions to `DraftCard` and per-layer KPI to `FunnelLayerSection`. No fetching.
 * Invariants:
 *   - FILTER_IS_VIEW_ONLY: the filter narrows what renders; it never mutates posts.
 *   - PER_LAYER_KPI: the KPI bar per lane is the facade value, unaffected by filter.
 * Side-effects: none
 * Links: ../[campaignId]/view.tsx, ./FunnelLayerSection.tsx, ./DraftCard.tsx
 * @internal
 */

"use client";

import { type ReactElement, useMemo, useState } from "react";

import { Button } from "@/components";
import type {
  CampaignDetail,
  CampaignPost,
} from "@/app/_facades/growth/campaigns.server";
// CLIENT-SAFE value import — pulling FUNNEL_LAYERS from campaigns.server (which
// imports db/LLM) dragged Node built-ins (fs/child_process/dns) into the browser
// bundle and broke the Next build. The constant lives in campaigns.shared.
import { FUNNEL_LAYERS } from "@/app/_facades/growth/campaigns.shared";

import { FunnelLayerSection } from "./FunnelLayerSection";

/** Status-filter views. "active" = everything except rejected (the default). */
type Filter = "active" | "all" | "generated" | "approved" | "rejected";

const FILTERS: ReadonlyArray<{ key: Filter; label: string }> = [
  { key: "active", label: "Active" },
  { key: "all", label: "All" },
  { key: "generated", label: "Generated" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

/** Does a post pass the current filter view? */
function passes(post: CampaignPost, filter: Filter): boolean {
  return statusPasses(post.status, filter);
}

function statusPasses(status: string, filter: Filter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "active":
      return status !== "rejected";
    default:
      // generated also surfaces the transient "refining" state.
      return filter === "generated"
        ? status === "generated" || status === "refining"
        : status === filter;
  }
}

export function CampaignFunnel({
  campaign,
}: {
  campaign: CampaignDetail;
}): ReactElement {
  const [filter, setFilter] = useState<Filter>("active");

  // Count posts per filter so the controls double as a glance at the queue state.
  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      active: 0,
      all: 0,
      generated: 0,
      approved: 0,
      rejected: 0,
    };
    for (const p of campaign.posts) {
      for (const f of FILTERS) {
        if (passes(p, f.key)) c[f.key] += 1;
      }
    }
    return c;
  }, [campaign.posts]);

  const visiblePosts = useMemo(
    () => campaign.posts.filter((p) => passes(p, filter)),
    [campaign.posts, filter]
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Light organization: a status filter above the lanes. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs">Show</span>
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            type="button"
            size="sm"
            variant={filter === f.key ? "default" : "outline"}
            className="h-7 gap-1.5 px-2.5 text-xs"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            <span className="tabular-nums opacity-70">{counts[f.key]}</span>
          </Button>
        ))}
      </div>

      <div className="flex flex-col gap-4">
        {FUNNEL_LAYERS.map((layer) => (
          <FunnelLayerSection
            key={layer}
            campaignId={campaign.campaignId}
            layer={layer}
            kpi={campaign.layers[layer]}
            targetRate={campaign.targetRate}
            posts={visiblePosts.filter((p) => p.funnelLayer === layer)}
            moltbookConnection={campaign.moltbookConnection}
            onStatusChange={(status) => {
              if (!statusPasses(status, filter)) {
                setFilter("active");
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}
