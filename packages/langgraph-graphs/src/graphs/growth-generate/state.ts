// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/growth-generate/state`
 * Purpose: State schema for the growth-generate CATALOG GRAPH — the dashboard-visible,
 *   schedulable wrapper around the pure `runGrowthGenerate` workflow. Carries the
 *   generate INPUT (campaign strategy + findings + funnel targets), the produced
 *   `drafts`, and `messages` (so the run surfaces its result on the run dashboard).
 * Scope: Defines the StateGraph annotation. Does NOT execute graph logic or do I/O.
 * Invariants:
 *   - STATE_EXTENDS_MESSAGES: includes messages for run-dashboard output tracking
 *   - INPUT_FROM_CONFIGURABLE_OR_BRIEF: the generate input arrives via
 *     `configurable.growthGenerate`; a scheduled/chat run with only a brief in the
 *     latest human message still works (the node derives a minimal strategy).
 *   - DRAFTS_ARE_OUTPUT_ONLY: `drafts` is the funnel-populating output; persistence
 *     (as `posts`) is the CALLER's job, never this graph's (PACKAGES_NO_SRC_IMPORTS).
 *   - PACKAGES_NO_SRC_IMPORTS: no imports from src/**
 * Side-effects: none
 * Links: ./graph.ts, ./workflow.ts, docs/guides/node-temporal.md
 * @public
 */

import { Annotation, MessagesAnnotation } from "@langchain/langgraph";

import type {
  DraftPost,
  FunnelTargets,
  GenerateFinding,
} from "./workflow";
import type { CampaignStrategy } from "../growth-research/workflow";

/**
 * The generate input handed to the graph via `configurable.growthGenerate`.
 * Mirrors `RunGrowthGenerateInput`, minus the injected callables (the graph wires
 * `complete` from its injected LLM and leaves `recallPlaybook` to the caller).
 */
export interface GrowthGenerateConfig {
  readonly strategy: CampaignStrategy;
  readonly findings?: readonly GenerateFinding[];
  readonly funnelTargets?: FunnelTargets | null;
  readonly defaultPerLayer?: number;
  readonly maxPerLayer?: number;
}

/**
 * Growth-generate graph state.
 *
 * The graph is a single GENERATE node: it reads `GrowthGenerateConfig` from
 * `configurable.growthGenerate` (or derives a minimal strategy from the latest
 * human message brief), runs the pure `runGrowthGenerate`, and writes the produced
 * `drafts` to state plus a JSON AIMessage so the run dashboard shows the output.
 */
export const GrowthGenerateStateAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,

  /** The funnel-populating draft posts produced by the generate node. */
  drafts: Annotation<DraftPost[]>({
    reducer: (_, right) => right ?? [],
    default: () => [],
  }),
});

export type GrowthGenerateState = typeof GrowthGenerateStateAnnotation.State;
