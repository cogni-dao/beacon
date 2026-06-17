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
 *   - WRITES_VIA_API: the create affordance POSTs to the API (RLS-scoped); the
 *     grid itself is presentation over already-loaded rows.
 *   - RESPONSIVE: 1 column on mobile, 2–3 on larger viewports.
 * Side-effects: none
 * Links: ./page.tsx, ./_components/CampaignCard.tsx, ./_components/NewCampaignSheet.tsx
 * @public
 */

import type { ReactElement } from "react";

import type { CampaignLensRow } from "./_api/fetchCampaigns";
import { CampaignCard } from "./_components/CampaignCard";
import { NewCampaignSheet } from "./_components/NewCampaignSheet";

export function GrowthView({
  campaigns,
}: {
  campaigns: CampaignLensRow[];
}): ReactElement {
  return (
    <div className="flex flex-col gap-4 p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-xl tracking-tight md:text-2xl">
            Growth
          </h1>
          <p className="text-muted-foreground text-sm">
            Campaigns growing Cogni, scored on real engagement.
          </p>
        </div>
        <NewCampaignSheet />
      </div>

      {campaigns.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border border-dashed p-10 text-center text-muted-foreground text-sm">
          No campaigns yet. Create your first one to start the growth loop.
          <NewCampaignSheet />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {campaigns.map((c) => (
            <CampaignCard key={c.campaignId} row={c} />
          ))}
        </div>
      )}
    </div>
  );
}
