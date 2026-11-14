// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/content/state`
 * Purpose: State schema for the content production graph (ideate→draft→critique→adapt).
 * Scope: Defines the StateGraph annotation. Does NOT execute graph logic.
 * Invariants:
 *   - STATE_EXTENDS_MESSAGES: includes messages for conversation/output tracking
 *   - VARIANT_PER_LAYER_PER_CHANNEL: `variants` holds one entry per (funnel layer ×
 *     enabled channel) — the graph produces a small CLASSIFIED queue spanning the funnel.
 *   - FUNNEL_LAYER_CLASSIFIED: every variant carries its `funnelLayer` + `topic`.
 *   - PACKAGES_NO_SRC_IMPORTS: no imports from src/**
 * Side-effects: none
 * Links: https://beacon.cognidao.org/knowledge/growth-loop-contract, .context/specs/pr4-funnel.md
 * @public
 */

import { Annotation, MessagesAnnotation } from "@langchain/langgraph";

/**
 * The three funnel layers a campaign's queue spans:
 *   tofu (awareness, broadest) → mofu (consideration) → bofu (call-to-action).
 */
export const FUNNEL_LAYERS = ["tofu", "mofu", "bofu"] as const;
export type FunnelLayer = (typeof FUNNEL_LAYERS)[number];

/**
 * One platform-adapted variant emitted by the adapt node — classified by funnel
 * layer + topic so the persisted queue is a planned funnel, not one flat stream.
 */
export interface ContentVariant {
  /** Funnel position this variant occupies (tofu/mofu/bofu). */
  funnelLayer: FunnelLayer;
  /** Subject this variant angles at (e.g. "ownership"); used to tag the broadcast. */
  topic: string;
  /** Target channel (e.g. "x", "moltbook"). */
  channel: string;
  /** Platform-adapted post text. */
  text: string;
}

/**
 * Content production graph state.
 *
 * The graph walks: ideate → draft → critique/revise → adapt-per-platform, looped
 * once per funnel layer (`tofu`/`mofu`/`bofu`). `enabledChannels` is seeded from
 * `configurable.enabledChannels`; the adapt node emits one `variants` entry per
 * (layer × channel), so the output is a small classified queue spanning the funnel.
 */
export const ContentStateAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,

  /** Channels to produce variants for (one variant emitted per layer × channel). */
  enabledChannels: Annotation<string[]>({
    reducer: (_, right) => right ?? [],
    default: () => [],
  }),

  /** Distinct angles/hooks expanded from the brief. */
  angles: Annotation<string[]>({
    reducer: (_, right) => right ?? [],
    default: () => [],
  }),

  /** First-pass draft for the chosen angle. */
  draft: Annotation<string>({
    reducer: (_, right) => right ?? "",
    default: () => "",
  }),

  /** Revised draft after the self-critique pass. */
  revised: Annotation<string>({
    reducer: (_, right) => right ?? "",
    default: () => "",
  }),

  /** Classified queue: one variant per (funnel layer × enabled channel). */
  variants: Annotation<ContentVariant[]>({
    reducer: (_, right) => right ?? [],
    default: () => [],
  }),
});

export type ContentState = typeof ContentStateAnnotation.State;
