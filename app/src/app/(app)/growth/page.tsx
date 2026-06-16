// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/page`
 * Purpose: `/growth` lens shell — server-side auth check + campaign load, then
 *   renders the read-only view. Mirrors `/work`'s protected-route pattern.
 * Scope: Auth + server data fetch via the growth facade. No business logic.
 * Invariants: Protected route (server-side auth check); READ_ONLY.
 * Side-effects: IO (Doltgres + Postgres reads via facade)
 * Links: ./view.tsx, app/src/app/_facades/growth/campaigns.server.ts
 * @public
 */

import { redirect } from "next/navigation";

import { getServerSessionUser } from "@/lib/auth/server";
import { listGrowthCampaigns } from "./_api/fetchCampaigns";
import { GrowthView } from "./view";

export const dynamic = "force-dynamic";

export default async function GrowthPage() {
  const user = await getServerSessionUser();
  if (!user) {
    redirect("/");
  }

  const campaigns = await listGrowthCampaigns();
  return <GrowthView campaigns={campaigns} />;
}
