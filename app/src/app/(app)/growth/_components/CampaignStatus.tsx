// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_components/CampaignStatus`
 * Purpose: Derive + render a campaign's lifecycle status as a glanceable dot +
 *   label. Status reflects the GROWTH LOOP (Draft → Posted → Measuring →
 *   Validated/Invalidated) — deliberately NOT deploy vocabulary like "in flight".
 * Scope: Pure presentation + a pure derivation from the lens row counters.
 * Invariants: Status derives only from loop counters (posts/snapshots/resolution).
 * Side-effects: none
 * Links: ./CampaignCard.tsx, ../[campaignId]/view.tsx
 * @internal
 */

import type { ReactElement } from "react";

import { cn } from "@cogni/node-ui-kit/util/cn";

import type { CampaignLensRow } from "../_api/fetchCampaigns";

export type CampaignStatusKind =
  | "draft"
  | "posted"
  | "measuring"
  | "validated"
  | "invalidated";

type StatusRow = Pick<
  CampaignLensRow,
  "resolved" | "edge" | "postedBroadcasts" | "snapshotCount"
>;

interface StatusInfo {
  kind: CampaignStatusKind;
  label: string;
  /** Tailwind classes for the status dot (semantic tokens only). */
  dotClass: string;
}

/** Map the loop counters to a single human-facing lifecycle status. */
export function campaignStatus(row: StatusRow): StatusInfo {
  if (row.resolved) {
    return row.edge === "validates"
      ? { kind: "validated", label: "Validated", dotClass: "bg-success" }
      : {
          kind: "invalidated",
          label: "Invalidated",
          dotClass: "bg-destructive",
        };
  }
  if (row.postedBroadcasts === 0) {
    return { kind: "draft", label: "Draft", dotClass: "bg-muted-foreground/50" };
  }
  if (row.snapshotCount === 0) {
    return { kind: "posted", label: "Posted", dotClass: "bg-primary" };
  }
  return {
    kind: "measuring",
    label: "Measuring",
    dotClass: "bg-primary animate-pulse",
  };
}

export function CampaignStatusBadge({
  row,
}: {
  row: StatusRow;
}): ReactElement {
  const status = campaignStatus(row);
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-0.5 font-medium text-foreground text-xs">
      <span
        className={cn("size-1.5 rounded-full", status.dotClass)}
        aria-hidden="true"
      />
      {status.label}
    </span>
  );
}
