// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/[campaignId]/page`
 * Purpose: Campaign detail page — what the campaign is (brief/goal), its
 *   independent KPI, and the posts + cached metrics that produced it. The page
 *   humans click into from a `/growth` card.
 * Scope: Server-side auth check + campaign load via the growth facade.
 * Invariants: Protected route (server-side auth check); READ_ONLY.
 * Side-effects: IO (Doltgres + Postgres reads via facade)
 * Links: ./view.tsx, app/src/app/_facades/growth/campaigns.server.ts
 * @public
 */

import { notFound, redirect } from "next/navigation";

import { getGrowthCampaign } from "@/app/_facades/growth/campaigns.server";
import { getServerSessionUser } from "@/lib/auth/server";
import { CampaignDetailView } from "./view";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const user = await getServerSessionUser();
  if (!user) {
    redirect("/");
  }

  const { campaignId } = await params;
  const campaign = await getGrowthCampaign(decodeURIComponent(campaignId));
  if (!campaign) {
    notFound();
  }

  return <CampaignDetailView campaign={campaign} />;
}
