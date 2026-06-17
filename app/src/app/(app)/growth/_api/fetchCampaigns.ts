// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_api/fetchCampaigns`
 * Purpose: Server-side data loader for the `/growth` lens. Thin re-export of the
 *   growth campaigns facade so the page boundary imports one stable name.
 * Scope: Data loading only. No presentation, no business logic.
 * Invariants: READ_ONLY, PORT_VIA_CONTAINER (delegates to the facade).
 * Side-effects: IO (Doltgres + Postgres reads via facade)
 * Links: app/src/app/_facades/growth/campaigns.server.ts
 * @internal
 */

export {
  type CampaignLensRow,
  listGrowthCampaigns,
} from "@/app/_facades/growth/campaigns.server";
