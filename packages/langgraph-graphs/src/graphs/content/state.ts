// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/content/state`
 * Purpose: State schema for the content production graph (ideate→draft→critique→adapt).
 * Scope: Defines the StateGraph annotation. Does NOT execute graph logic.
 * Invariants:
 *   - STATE_EXTENDS_MESSAGES: includes messages for conversation/output tracking
 *   - ONE_VARIANT_PER_CHANNEL: `variants` holds exactly one entry per enabled channel
 *   - PACKAGES_NO_SRC_IMPORTS: no imports from src/**
 * Side-effects: none
 * Links: docs/spec/beacon-growth-loop-v0.md §1
 * @public
 */

import { Annotation, MessagesAnnotation } from "@langchain/langgraph";

/**
 * One platform-adapted variant emitted by the adapt node.
 */
export interface ContentVariant {
  /** Target channel (e.g. "x", "moltbook"). */
  channel: string;
  /** Platform-adapted post text. */
  text: string;
}

/**
 * Content production graph state.
 *
 * The graph walks: ideate → draft → critique/revise → adapt-per-platform.
 * `enabledChannels` is seeded from `configurable.enabledChannels`; the adapt
 * node emits exactly one `variants` entry per enabled channel.
 */
export const ContentStateAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,

  /** Channels to produce variants for (one variant emitted per channel). */
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

  /** One platform-adapted variant per enabled channel (final output). */
  variants: Annotation<ContentVariant[]>({
    reducer: (_, right) => right ?? [],
    default: () => [],
  }),
});

export type ContentState = typeof ContentStateAnnotation.State;
