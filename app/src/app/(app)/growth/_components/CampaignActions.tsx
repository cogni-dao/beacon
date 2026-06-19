// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_components/CampaignActions`
 * Purpose: The on-demand loop drivers on the campaign detail page — RESEARCH and
 *   GENERATE buttons. These are how a human advances the loop in v0 (the autonomous
 *   heartbeat that runs them off `status='active'` is a later PR). Generate is the
 *   proven path: one click calls `/generate`, persists drafts as `posts`, and the
 *   page refresh renders them in the funnel lanes below.
 * Scope: Client mutations + minimal local state. Refreshes via `router.refresh()`
 *   so the freshly-written findings/drafts appear without a manual reload.
 * Invariants:
 *   - ON_DEMAND_V0: these buttons are the manual loop driver; nothing here publishes.
 *     Generate only fills the `generated` queue (the publish/approve path is separate).
 * Side-effects: IO (POST /api/v1/growth/campaigns/:id/{research,generate}).
 * Links: ../_api/mutateCampaign.ts, ../[campaignId]/view.tsx
 * @internal
 */

"use client";

import { Sparkles, Telescope } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactElement, useState } from "react";

import { Button } from "@/components";

import { generatePosts, runResearch } from "../_api/mutateCampaign";

export function CampaignActions({
  campaignId,
}: {
  campaignId: string;
}): ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState<"research" | "generate" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (
    activity: "research" | "generate",
    fn: () => Promise<number>,
    label: (n: number) => string
  ) => {
    setBusy(activity);
    setNote(null);
    setError(null);
    try {
      const count = await fn();
      setNote(label(count));
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1.5"
          disabled={busy !== null}
          onClick={() =>
            run("research", () => runResearch(campaignId), (n) =>
              n > 0
                ? `Research added ${n} finding${n === 1 ? "" : "s"}.`
                : "Research ran — no findings produced."
            )
          }
        >
          <Telescope className="size-3.5" aria-hidden="true" />
          {busy === "research" ? "Researching…" : "Research"}
        </Button>

        <Button
          type="button"
          size="sm"
          className="h-8 gap-1.5"
          disabled={busy !== null}
          onClick={() =>
            run("generate", () => generatePosts(campaignId), (n) =>
              n > 0
                ? `Generated ${n} draft${n === 1 ? "" : "s"} — see the lanes below.`
                : "Generate ran — no drafts produced."
            )
          }
        >
          <Sparkles className="size-3.5" aria-hidden="true" />
          {busy === "generate" ? "Generating…" : "Generate drafts"}
        </Button>
      </div>

      {note && !error && (
        <p className="text-muted-foreground text-xs" role="status">
          {note}
        </p>
      )}
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
