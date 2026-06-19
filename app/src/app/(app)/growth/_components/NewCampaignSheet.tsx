// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_components/NewCampaignSheet`
 * Purpose: "+ New campaign" affordance for `/growth` — the DEFINE step. A trigger
 *   button + a slide-over form that captures the campaign's durable DNA
 *   (core topic · voice · ICP · objective) — the strategy the AI injects into every
 *   research/generate run. KPI mechanics (target rate, evaluate-by) and the slug are
 *   handled server-side / auto-derived; they are NOT user inputs.
 * Scope: Local form state + the create mutation. Refreshes via `router.refresh()`.
 * Invariants:
 *   - DEFINE_IS_THE_DNA: the four fields are what ground all downstream AI output;
 *     the form makes that explicit and pushes for specificity.
 *   - NO_DEV_MECHANICS_IN_UX: no hypothesis jargon, no target-rate, no evaluate-by,
 *     no exposed slug — those are defaulted/derived, never asked of the user.
 * Side-effects: IO (POST /api/v1/growth/campaigns via createCampaign).
 * Links: ./_api/mutateCampaign.ts, docs/research/marketing-platforms-landscape.md (DEFINE)
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
import { deriveCampaignId, slugify } from "./slug";

/** One labelled multi-line DEFINE field with grounded helper copy. */
function DefineField({
  id,
  label,
  hint,
  placeholder,
  value,
  onChange,
  rows = 2,
}: {
  id: string;
  label: string;
  hint: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}): ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="font-medium text-muted-foreground text-xs uppercase tracking-wider"
      >
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[var(--ring-width-sm)] focus-visible:ring-ring"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={1000}
        required
      />
      <span className="text-muted-foreground text-xs">{hint}</span>
    </div>
  );
}

export function NewCampaignSheet(): ReactElement {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [coreTopic, setCoreTopic] = useState("");
  const [voice, setVoice] = useState("");
  const [icp, setIcp] = useState("");
  const [objective, setObjective] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle("");
    setCoreTopic("");
    setVoice("");
    setIcp("");
    setObjective("");
    setError(null);
    setSubmitting(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    setOpen(next);
  };

  // The slug is auto-derived (base + random suffix) and never shown — it's
  // machine plumbing, not UX. We validate the base so the title yields a slug
  // that satisfies ID_PATTERN before we tack on the suffix at submit time.
  const idValid = slugify(title).length >= 1;
  const titleValid = title.trim().length >= 1 && title.length <= 200;
  const filled =
    coreTopic.trim().length >= 1 &&
    voice.trim().length >= 1 &&
    icp.trim().length >= 1 &&
    objective.trim().length >= 1;
  const canSubmit = idValid && titleValid && filled && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await createCampaign({
        // Unique per submit: same-titled campaigns get distinct slugs.
        campaignId: deriveCampaignId(title),
        title: title.trim(),
        coreTopic: coreTopic.trim(),
        voice: voice.trim(),
        icp: icp.trim(),
        objective: objective.trim(),
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
            Define your campaign
          </SheetTitle>
          <span className="text-muted-foreground text-xs">
            These four fields are your campaign&apos;s DNA — the AI uses them on{" "}
            <strong className="text-foreground">every single post</strong> it
            writes. Specific in, sharp out; vague in, generic out. Make them great.
          </span>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-5 px-1">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="campaign-title"
              className="font-medium text-muted-foreground text-xs uppercase tracking-wider"
            >
              Campaign name
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

          <DefineField
            id="campaign-topic"
            label="Core topic"
            hint="The one subject every post orbits."
            placeholder="Why technical founders should own their AI infrastructure instead of renting it."
            value={coreTopic}
            onChange={setCoreTopic}
          />

          <DefineField
            id="campaign-voice"
            label="Voice"
            hint="Tone, attitude, vocabulary — how it should sound."
            placeholder="Direct, a little contrarian, founder-to-founder. Concrete over corporate. No hype, no emoji."
            value={voice}
            onChange={setVoice}
          />

          <DefineField
            id="campaign-icp"
            label="Audience (ICP)"
            hint="Who exactly are you talking to? The more specific, the better."
            placeholder="Technical startup founders who distrust marketing fluff and care about owning their stack."
            value={icp}
            onChange={setIcp}
          />

          <DefineField
            id="campaign-objective"
            label="Objective"
            hint="What should they think, feel, or do after reading?"
            placeholder="Believe Cogni is the credible way to own your AI — and follow for more."
            value={objective}
            onChange={setObjective}
          />

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
              {submitting ? "Creating…" : "Create campaign"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
