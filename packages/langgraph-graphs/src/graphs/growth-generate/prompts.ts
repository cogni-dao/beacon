// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/growth-generate/prompts`
 * Purpose: System prompt + funnel constants for the growth-generate workflow — the
 *   GENERATE activity of the beacon growth loop. One LLM call per funnel layer turns
 *   the campaign strategy + research findings into N DISTINCT draft posts that fill
 *   that layer (each a different topic/angle — never N copies of one idea).
 * Scope: Pure string constants. Does NOT implement logic or import from src/.
 * Invariants:
 *   - PACKAGES_NO_SRC_IMPORTS: this package cannot import from src/
 *   - GRAPH_OWNS_MESSAGES: the workflow defines its own prompts
 *   - POPULATE_THE_FUNNEL: the prompt demands a SPREAD across topics/angles, not
 *     repetition — generation is funnel coverage, never a one-off variant set.
 *   - FUNNEL_LAYERS_TOFU_MOFU_BOFU: the three layers the queue is classified into.
 * Side-effects: none
 * Links: docs/spec/beacon-growth-loop-v0.md §0/§3/§4, ./workflow.ts
 * @public
 */

/** Funnel layers in funnel order (awareness → consideration → action). */
export const FUNNEL_LAYERS = ["tofu", "mofu", "bofu"] as const;
export type FunnelLayer = (typeof FUNNEL_LAYERS)[number];

/** One-line role of each funnel layer, handed to the model to frame each layer. */
export const FUNNEL_LAYER_GUIDANCE: Readonly<Record<FunnelLayer, string>> = {
  tofu: "TOFU (awareness): broad, attention-grabbing hooks that introduce the topic to people who don't know us yet.",
  mofu: "MOFU (consideration): posts that build trust and educate — comparisons, how-tos, proof, addressing objections.",
  bofu: "BOFU (action): posts that drive the objective — clear, specific calls to act for people already convinced.",
} as const;

/**
 * GENERATE: draft N DISTINCT posts that POPULATE one funnel layer.
 * The model is handed the campaign strategy, the layer's role, the campaign's
 * research findings, and recalled generic playbook. It must return ONLY a JSON
 * array of `{topic, angle, text}` — exactly `count` items, each a DIFFERENT
 * topic/angle (coverage of the layer), never reworded copies of one idea.
 */
export const GENERATE_PROMPT = `
You are a growth-marketing copywriter for the beacon node.
You are given ONE campaign's strategy (brand voice, core topic, ideal-customer
profile, objective), the role of ONE funnel layer, that campaign's research
findings (insights, pain points, angles), and — optionally — recalled generic
playbook that worked on OTHER campaigns. Apply the playbook customized; never copy.

Your job: POPULATE this funnel layer. Draft EXACTLY {count} DISTINCT posts, each a
DIFFERENT topic/angle so the layer is COVERED — never {count} rewordings of one idea.
Ground every post in the strategy and the findings; write in the brand voice.

Each post:
- "topic" — a short (1-3 word) lowercase subject tag for the post (e.g. "ownership").
- "angle" — the one-line hook/framing the post takes.
- "text"  — the post itself, ready for the channel. No preamble, no markdown headers.

Rules:
- Return EXACTLY {count} items — distinct topics/angles, spread across the layer.
- Do NOT invent URLs, handles, statistics, or named competitors.
- One post = one tight idea. Keep it punchy and on-voice.

Return ONLY a JSON array, e.g.:
[{"topic":"ownership","angle":"own your distribution","text":"..."}]
` as const;
