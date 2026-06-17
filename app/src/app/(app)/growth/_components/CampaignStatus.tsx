// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_components/CampaignStatus`
 * Purpose: Render a campaign's OWNED lifecycle status (draft/active/paused/done)
 *   as a glanceable dot + label. The status is the `campaigns.status` column now —
 *   not derived from loop counters — so it reflects what the user toggled in the UI.
 * Scope: Pure presentation + a pure mapping from the owned status enum.
 * Invariants: Status comes from the table (STATUS_FROM_TABLE), never recomputed.
 * Side-effects: none
 * Links: ./CampaignCard.tsx, ../[campaignId]/view.tsx, ./CampaignStatusToggle.tsx
 * @internal
 */

import type { ReactElement } from "react";

import { cn } from "@cogni/node-ui-kit/util/cn";

import type { CampaignStatus } from "@/app/_facades/growth/campaigns.server";

interface StatusInfo {
  label: string;
  /** Tailwind classes for the status dot (semantic tokens only). */
  dotClass: string;
}

/** Map the owned lifecycle status to a human-facing label + dot. */
export function campaignStatusInfo(status: CampaignStatus): StatusInfo {
  switch (status) {
    case "active":
      return { label: "Active", dotClass: "bg-primary animate-pulse" };
    case "paused":
      return { label: "Paused", dotClass: "bg-muted-foreground/50" };
    case "done":
      return { label: "Done", dotClass: "bg-success" };
    default:
      return { label: "Draft", dotClass: "bg-muted-foreground/50" };
  }
}

export function CampaignStatusBadge({
  status,
}: {
  status: CampaignStatus;
}): ReactElement {
  const info = campaignStatusInfo(status);
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-0.5 font-medium text-foreground text-xs">
      <span
        className={cn("size-1.5 rounded-full", info.dotClass)}
        aria-hidden="true"
      />
      {info.label}
    </span>
  );
}
