// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_components/NewCampaignSheet`
 * Purpose: "+ New campaign" affordance for `/growth` — a trigger button + a
 *   slide-over Sheet form (title, brief, target rate, evaluateAt) that POSTs a new
 *   account-owned campaign, then refreshes the lens. Mirrors `AddDomainSheet`.
 * Scope: Local form state + the create mutation. Refreshes via `router.refresh()`.
 * Side-effects: IO (POST /api/v1/growth/campaigns via createCampaign).
 * Links: ./_api/mutateCampaign.ts, ../knowledge/_components/AddDomainSheet.tsx
 * @internal
 */

"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactElement, useState } from "react";

import {
  Button,
  Input,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components";

import { createCampaign } from "../_api/mutateCampaign";

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Slugify a free-text title into a campaign-id candidate. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Default budget deadline: 30 days out, at midnight UTC. */
function defaultEvaluateAt(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 30);
  return d.toISOString().slice(0, 10); // yyyy-mm-dd for a date input
}

export function NewCampaignSheet(): ReactElement {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [campaignId, setCampaignId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [targetPct, setTargetPct] = useState("2");
  const [evaluateDate, setEvaluateDate] = useState(defaultEvaluateAt());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-derive the slug from the title until the user edits the id directly.
  const effectiveId = idTouched ? campaignId : slugify(title);

  const reset = () => {
    setCampaignId("");
    setIdTouched(false);
    setTitle("");
    setBrief("");
    setTargetPct("2");
    setEvaluateDate(defaultEvaluateAt());
    setError(null);
    setSubmitting(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    setOpen(next);
  };

  const targetRate = Number(targetPct) / 100;
  const idValid = ID_PATTERN.test(effectiveId);
  const titleValid = title.trim().length >= 1 && title.length <= 200;
  const briefValid = brief.trim().length >= 1 && brief.length <= 4000;
  const rateValid =
    Number.isFinite(targetRate) && targetRate > 0 && targetRate <= 1;
  const dateValid = evaluateDate.length > 0;
  const canSubmit =
    idValid && titleValid && briefValid && rateValid && dateValid && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await createCampaign({
        campaignId: effectiveId,
        title: title.trim(),
        brief: brief.trim(),
        targetRate,
        // Resolve the date to end-of-day UTC so the deadline is inclusive.
        evaluateAt: new Date(`${evaluateDate}T23:59:59.000Z`).toISOString(),
      });
      reset();
      setOpen(false);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <Button
        type="button"
        size="sm"
        className="h-9 w-fit gap-1.5"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-3.5" />
        New campaign
      </Button>

      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="text-lg leading-snug">
            New campaign
          </SheetTitle>
          <span className="text-muted-foreground text-xs">
            Files a falsifiable hypothesis + an account-owned campaign record. Starts
            in <code className="font-mono">draft</code>.
          </span>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-5 px-1">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="campaign-title"
              className="font-medium text-muted-foreground text-xs uppercase tracking-wider"
            >
              Title
            </label>
            <Input
              id="campaign-title"
              className="h-9 text-sm"
              placeholder="Cogni owns its AI"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="campaign-id"
              className="font-medium text-muted-foreground text-xs uppercase tracking-wider"
            >
              Campaign ID
            </label>
            <Input
              id="campaign-id"
              className="h-9 font-mono text-sm"
              placeholder="cogni-owns-its-ai"
              value={effectiveId}
              onChange={(e) => {
                setIdTouched(true);
                setCampaignId(e.target.value.toLowerCase());
              }}
              autoComplete="off"
              spellCheck={false}
              required
            />
            <span className="text-muted-foreground text-xs">
              Lowercase slug{" "}
              <code className="font-mono">[a-z0-9][a-z0-9-]*</code> · auto-derived
              from the title.
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="campaign-brief"
              className="font-medium text-muted-foreground text-xs uppercase tracking-wider"
            >
              Brief
            </label>
            <textarea
              id="campaign-brief"
              className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[var(--ring-width-sm)] focus-visible:ring-ring"
              placeholder="The audience + angle + funnel-stage framing of the hypothesis."
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              maxLength={4000}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="campaign-target"
                className="font-medium text-muted-foreground text-xs uppercase tracking-wider"
              >
                Target rate %
              </label>
              <Input
                id="campaign-target"
                type="number"
                step="0.1"
                min="0.1"
                max="100"
                className="h-9 text-sm tabular-nums"
                value={targetPct}
                onChange={(e) => setTargetPct(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="campaign-evaluate"
                className="font-medium text-muted-foreground text-xs uppercase tracking-wider"
              >
                Evaluate by
              </label>
              <Input
                id="campaign-evaluate"
                type="date"
                className="h-9 text-sm"
                value={evaluateDate}
                onChange={(e) => setEvaluateDate(e.target.value)}
                required
              />
            </div>
          </div>

          {error && (
            <p
              className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-xs"
              role="alert"
            >
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="h-9 gap-1.5"
              disabled={!canSubmit}
            >
              <Plus className="size-3.5" />
              {submitting ? "Creating…" : "Create"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
