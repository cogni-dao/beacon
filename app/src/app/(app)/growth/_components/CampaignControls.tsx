// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_components/CampaignControls`
 * Purpose: The campaign detail control panel actions — a real draft↔active status
 *   toggle (PATCH) and a delete action (DELETE). Replaces the disabled pause/resume
 *   placeholder with a working status toggle.
 * Scope: Client mutations + minimal local state. Refreshes via `router.refresh()`
 *   on status change; navigates to `/growth` after delete.
 * Invariants:
 *   - STATUS_PERSIST_ONLY: the toggle only persists `status`. Wiring status→Temporal
 *     schedule pause/resume is the HEARTBEAT PR (noted in the route + this UI).
 * Side-effects: IO (PATCH/DELETE /api/v1/growth/campaigns/:id).
 * Links: ./_api/mutateCampaign.ts, ../[campaignId]/view.tsx
 * @internal
 */

"use client";

import { Pause, Play, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactElement, useState } from "react";

import { Button } from "@/components";

import {
  type CampaignStatus,
  deleteCampaign,
  setCampaignStatus,
} from "../_api/mutateCampaign";

export function CampaignControls({
  campaignId,
  status,
}: {
  campaignId: string;
  status: CampaignStatus;
}): ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState<"toggle" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isActive = status === "active";
  // Draft/paused → activate; active → pause back to draft.
  const nextStatus: CampaignStatus = isActive ? "draft" : "active";

  const handleToggle = async () => {
    setBusy("toggle");
    setError(null);
    try {
      await setCampaignStatus(campaignId, nextStatus);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    setBusy("delete");
    setError(null);
    try {
      await deleteCampaign(campaignId);
      router.push("/growth");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={isActive ? "outline" : "default"}
          className="h-8 gap-1.5"
          onClick={handleToggle}
          disabled={busy !== null}
        >
          {isActive ? (
            <Pause className="size-3.5" aria-hidden="true" />
          ) : (
            <Play className="size-3.5" aria-hidden="true" />
          )}
          {busy === "toggle"
            ? "Saving…"
            : isActive
              ? "Set to draft"
              : "Activate"}
        </Button>

        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="h-8 gap-1.5"
              onClick={handleDelete}
              disabled={busy !== null}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              {busy === "delete" ? "Deleting…" : "Confirm delete"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={() => setConfirmDelete(false)}
              disabled={busy !== null}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 text-muted-foreground hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
            disabled={busy !== null}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            Delete
          </Button>
        )}
      </div>

      {error && (
        <p
          className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-xs"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
