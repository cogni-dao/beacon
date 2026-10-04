// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/growth/_components/campaignStrategyPresets`
 * Purpose: Client-safe campaign strategy presets used by creation/edit UI.
 * Scope: Static product taxonomy only. Durable campaign storage remains the
 *   first-class strategy fields: objective, icp, coreTopic, and voice.
 * Side-effects: none
 * @internal
 */

export interface StrategyPreset {
  id: string;
  label: string;
  value: string;
}

export const GOAL_PRESETS = [
  {
    id: "awareness",
    label: "Awareness",
    value:
      "Make the right audience understand the problem and recognize Cogni as a credible way to solve it.",
  },
  {
    id: "trust",
    label: "Trust",
    value:
      "Build confidence through proof, specificity, and useful operator-grade thinking.",
  },
  {
    id: "conversion",
    label: "Conversion",
    value:
      "Move convinced readers toward a concrete next step: follow, join, try, or ask for access.",
  },
] as const satisfies readonly StrategyPreset[];

export const AUDIENCE_PRESETS = [
  {
    id: "technical-founders",
    label: "Technical founders",
    value:
      "Technical startup founders who distrust marketing fluff and care about owning their AI stack.",
  },
  {
    id: "ai-operators",
    label: "AI operators",
    value:
      "AI operators building agent workflows who need reliable infrastructure, provenance, and approval gates.",
  },
  {
    id: "community-builders",
    label: "Community builders",
    value:
      "Community builders who need repeatable content loops that compound trust without losing human approval.",
  },
] as const satisfies readonly StrategyPreset[];

export const VOICE_PRESETS = [
  {
    id: "operator-grade",
    label: "Operator-grade",
    value:
      "Direct, concrete, and calm. Specific over corporate. No hype, no emoji, no vague transformation claims.",
  },
  {
    id: "founder-to-founder",
    label: "Founder-to-founder",
    value:
      "Plainspoken and slightly contrarian. Write like a technical founder talking to another technical founder.",
  },
  {
    id: "educational",
    label: "Educational",
    value:
      "Useful, crisp, and explanatory. Teach one practical idea at a time without sounding like a report.",
  },
] as const satisfies readonly StrategyPreset[];

