// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/content/prompts`
 * Purpose: System/instruction prompts for the content production graph.
 * Scope: Pure string constants. Does NOT implement logic or import from src/.
 * Invariants:
 *   - PACKAGES_NO_SRC_IMPORTS: this package cannot import from src/
 *   - GRAPH_OWNS_MESSAGES: graph defines its own prompts
 * Side-effects: none
 * Links: docs/spec/beacon-growth-loop-v0.md §1
 * @public
 */

/**
 * IDEATE: expand the brief into a few distinct angles/hooks.
 */
export const IDEATE_PROMPT = `
You are a growth-marketing strategist for the beacon node.
Given a campaign brief, expand it into 3 distinct, sharp angles (hooks) for content.
Each angle should attack the topic from a different motivation (curiosity, urgency, proof, contrarian, aspiration).

Return ONLY a JSON array of 3 short angle strings, e.g.:
["angle one", "angle two", "angle three"]
` as const;

/**
 * DRAFT: write a first-pass core post for the strongest angle.
 */
export const DRAFT_PROMPT = `
You are a sharp copywriter. Write a single first-pass core post for the strongest angle below.
Keep it platform-neutral (you will adapt per platform later). Lead with the hook.
Return ONLY the post text — no preamble, no quotes.
` as const;

/**
 * CRITIQUE/REVISE: one self-revise pass — critique then output the improved draft.
 */
export const CRITIQUE_PROMPT = `
You are a ruthless editor. Critique the draft below for hook strength, clarity, and a single
clear call-to-action, then rewrite it once to fix the biggest weaknesses.
Return ONLY the improved post text — no critique notes, no quotes.
` as const;

/**
 * ADAPT: rewrite the revised core post for one specific channel.
 * `{channel}` and `{constraints}` are interpolated per channel.
 */
export const ADAPT_PROMPT = `
You are a platform specialist. Adapt the core post below for the channel "{channel}".
Constraints: {constraints}
Keep the hook first. Return ONLY the adapted post text — no preamble, no quotes.
` as const;

/**
 * Per-channel adaptation constraints. Unknown channels fall back to a neutral rule.
 */
export const CHANNEL_CONSTRAINTS: Readonly<Record<string, string>> = {
  x: "Hook-first, ≤280 characters, at most 2 hashtags, punchy and scannable.",
  moltbook:
    "Conversational long-form is fine; open with a strong first line; no character limit but stay focused.",
} as const;

/**
 * Neutral fallback for any channel without explicit constraints.
 */
export const DEFAULT_CHANNEL_CONSTRAINTS =
  "Keep it concise, hook-first, and platform-appropriate." as const;
