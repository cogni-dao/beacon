// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_components/CampaignStrategyPanel`
 * Purpose: First-class editable campaign strategy surface for the DEFINE step.
 * Scope: Client presentation + PATCH mutation. Keeps the product model as
 *   goal/audience/topic/voice instead of exposing the legacy composed brief.
 * Side-effects: PATCH /api/v1/growth/campaigns/:id via updateCampaignStrategy.
 * @internal
 */

"use client";

import { Check, Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactElement, useState } from "react";

import { Button, Card, CardContent } from "@/components";
import type { CampaignDetail } from "@/app/_facades/growth/campaigns.server";

import { updateCampaignStrategy } from "../_api/mutateCampaign";
import {
  AUDIENCE_PRESETS,
  GOAL_PRESETS,
  type StrategyPreset,
  VOICE_PRESETS,
} from "./campaignStrategyPresets";

function PresetButtons({
  presets,
  onSelect,
}: {
  presets: readonly StrategyPreset[];
  onSelect: (value: string) => void;
}): ReactElement {
  return (
    <div className="flex flex-wrap gap-1.5">
      {presets.map((preset) => (
        <Button
          key={preset.id}
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          onClick={() => onSelect(preset.value)}
        >
          {preset.label}
        </Button>
      ))}
    </div>
  );
}

function StrategyRow({
  label,
  value,
}: {
  label: string;
  value: string;
}): ReactElement {
  return (
    <div className="grid gap-1">
      <dt className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </dt>
      <dd className="text-sm leading-relaxed">{value || "Unset"}</dd>
    </div>
  );
}

function StrategyField({
  id,
  label,
  value,
  onChange,
  presets,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  presets?: readonly StrategyPreset[];
}): ReactElement {
  return (
    <div className="grid gap-2">
      <label
        htmlFor={id}
        className="font-medium text-muted-foreground text-xs uppercase tracking-wide"
      >
        {label}
      </label>
      {presets && <PresetButtons presets={presets} onSelect={onChange} />}
      <textarea
        id={id}
        rows={label === "Topic" ? 2 : 3}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[var(--ring-width-sm)] focus-visible:ring-ring"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
      />
    </div>
  );
}

export function CampaignStrategyPanel({
  campaign,
}: {
  campaign: CampaignDetail;
}): ReactElement {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [coreTopic, setCoreTopic] = useState(campaign.coreTopic);
  const [voice, setVoice] = useState(campaign.voice);
  const [icp, setIcp] = useState(campaign.icp);
  const [objective, setObjective] = useState(campaign.objective);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setCoreTopic(campaign.coreTopic);
    setVoice(campaign.voice);
    setIcp(campaign.icp);
    setObjective(campaign.objective);
    setError(null);
  };

  const canSave =
    coreTopic.trim().length > 0 &&
    voice.trim().length > 0 &&
    icp.trim().length > 0 &&
    objective.trim().length > 0 &&
    !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await updateCampaignStrategy(campaign.campaignId, {
        coreTopic: coreTopic.trim(),
        voice: voice.trim(),
        icp: icp.trim(),
        objective: objective.trim(),
      });
      setEditing(false);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Strategy
          </h2>
          {editing ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5"
                disabled={busy}
                onClick={() => {
                  reset();
                  setEditing(false);
                }}
              >
                <X className="size-3.5" aria-hidden="true" />
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1.5"
                disabled={!canSave}
                onClick={save}
              >
                <Check className="size-3.5" aria-hidden="true" />
                {busy ? "Saving..." : "Save"}
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              onClick={() => setEditing(true)}
            >
              <Pencil className="size-3.5" aria-hidden="true" />
              Edit
            </Button>
          )}
        </div>

        {editing ? (
          <div className="grid gap-4">
            <StrategyField
              id="campaign-objective-edit"
              label="Goal"
              value={objective}
              onChange={setObjective}
              presets={GOAL_PRESETS}
            />
            <StrategyField
              id="campaign-icp-edit"
              label="Audience"
              value={icp}
              onChange={setIcp}
              presets={AUDIENCE_PRESETS}
            />
            <StrategyField
              id="campaign-topic-edit"
              label="Topic"
              value={coreTopic}
              onChange={setCoreTopic}
            />
            <StrategyField
              id="campaign-voice-edit"
              label="Voice"
              value={voice}
              onChange={setVoice}
              presets={VOICE_PRESETS}
            />
            {error && (
              <p
                className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-xs"
                role="alert"
              >
                {error}
              </p>
            )}
          </div>
        ) : (
          <dl className="grid gap-4 md:grid-cols-2">
            <StrategyRow label="Goal" value={campaign.objective} />
            <StrategyRow label="Audience" value={campaign.icp} />
            <StrategyRow label="Topic" value={campaign.coreTopic} />
            <StrategyRow label="Voice" value={campaign.voice} />
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

