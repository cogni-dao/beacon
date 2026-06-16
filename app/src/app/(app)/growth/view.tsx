// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/view`
 * Purpose: Read-only `/growth` lens — surfaces every campaign hypothesis with
 *   its independent engagement KPI (score vs target) as a responsive card grid.
 *   Mirrors `/work` (server fetch → presentation) but read-only and simpler.
 * Scope: Presentation. Receives already-loaded `CampaignLensRow[]` from the
 *   server page; no client fetching.
 * Invariants:
 *   - READ_ONLY: the lens only observes the loop; all writes go through the API.
 *   - RESPONSIVE: 1 column on mobile, 2–3 on larger viewports.
 * Side-effects: none
 * Links: ./page.tsx, ./_components/CampaignCard.tsx
 * @public
 */

import type { ReactElement } from "react";

import type { CampaignLensRow } from "./_api/fetchCampaigns";
import { CampaignCard } from "./_components/CampaignCard";

export function GrowthView({
  campaigns,
}: {
  campaigns: CampaignLensRow[];
}): ReactElement {
  return (
    <div className="flex flex-col gap-4 p-5 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-semibold text-xl tracking-tight md:text-2xl">
          Growth
        </h1>
        <p className="text-muted-foreground text-sm">
          Campaigns growing Cogni, scored on real engagement.
        </p>
      </div>

      {campaigns.length === 0 ? (
        <div className="rounded-lg border border-border border-dashed p-10 text-center text-muted-foreground text-sm">
          No campaigns yet. File one via{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            POST /api/v1/growth/campaigns
          </code>
          .
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {campaigns.map((c) => (
            <CampaignCard key={c.hypothesisId} row={c} />
          ))}
        </div>
      )}
    </div>
  );
}
