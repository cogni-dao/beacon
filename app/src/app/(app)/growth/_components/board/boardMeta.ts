// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_components/board/boardMeta`
 * Purpose: Client-safe presentation metadata for the campaign pipeline board — the
 *   per-column label + one-line role, ordered left→right to mirror the loop the hub
 *   defines (INTELLIGENCE → GENERATE → REVIEW → APPROVED POST → MEASURE). Pure data,
 *   no server deps, so the "use client" board can import it.
 * Scope: constants + types only. No I/O.
 * Side-effects: none
 * Links: @/app/_facades/growth/campaigns.shared (PIPELINE_STAGES), ../CampaignBoard.tsx
 * @internal
 */

import type { PipelineStage } from "@/app/_facades/growth/campaigns.shared";

/** Human label + one-line role for each board column, shown in the column head. */
export const STAGE_META: Readonly<
  Record<PipelineStage, { label: string; role: string }>
> = {
  opportunities: { label: "Opportunities", role: "capture & research" },
  drafts: { label: "Drafts", role: "review & refine" },
  ready: { label: "Ready", role: "approved to post" },
  posted: { label: "Posted", role: "live & measured" },
  rejected: { label: "Rejected", role: "set aside" },
};
