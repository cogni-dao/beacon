// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/growth-generate/graph`
 * Purpose: CATALOG-GRAPH wrapper around the pure `runGrowthGenerate` workflow — the
 *   GENERATE activity of the beacon growth loop, made dashboard-visible and
 *   schedulable. A single-node StateGraph: read the campaign input, run the existing
 *   pure workflow (which POPULATES THE FUNNEL across TOFU/MOFU/BOFU), emit the drafts.
 *   Per docs/guides/node-temporal.md: "AI work is a graph, run on cron by the shared
 *   worker" — this is the graph; the cron registration is the schedule (see
 *   ./schedule registration). graphId is `langgraph:growth-generate`.
 * Scope: Pure factory. The single node bridges the injected LLM to the workflow's
 *   `CompleteFn` and calls `runGrowthGenerate`. Does NOT touch the DB, env, HTTP, or
 *   Doltgres — all I/O is the injected LLM (recall is left to the caller via config).
 * Invariants:
 *   - PURE_FACTORY: no side effects, no env reads; the LLM is injected (opts.llm).
 *   - WRAPS_DO_NOT_REWRITE: the thinking stays in `runGrowthGenerate`; this file only
 *     adapts it into a StateGraph node (LLM → CompleteFn, config → input).
 *   - STABLE_GRAPH_NAME: the name is EXACTLY "growth-generate" — a shared seam other
 *     graphs/UI may target; do not rename.
 *   - INPUT_FROM_CONFIGURABLE_OR_BRIEF: input arrives via `configurable.growthGenerate`;
 *     a run with only a brief in the latest human message still produces drafts.
 *   - TYPE_TRANSPARENT_RETURN: no explicit return type for CLI schema extraction.
 *   - PACKAGES_NO_SRC_IMPORTS: no imports from src/**
 * Side-effects: none (the injected LLM does the only I/O)
 * Links: ./workflow.ts, ./state.ts, ../content/graph.ts, docs/guides/node-temporal.md
 * @public
 */

import {
  AIMessage,
  type BaseMessage,
  SystemMessage,
  HumanMessage,
} from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import { StateGraph } from "@langchain/langgraph";

import type { CampaignStrategy, CompleteFn } from "../growth-research/workflow";
import type { CreateReactAgentGraphOptions } from "../types";
import {
  type GrowthGenerateConfig,
  GrowthGenerateStateAnnotation,
  type GrowthGenerateState,
} from "./state";
import { runGrowthGenerate } from "./workflow";

/**
 * Graph name constant for routing. STABLE_GRAPH_NAME: exactly "growth-generate".
 * Fully-qualified graphId is `langgraph:growth-generate` (see catalog).
 */
export const GROWTH_GENERATE_GRAPH_NAME = "growth-generate" as const;

/**
 * Narrowed LLM surface the generate node needs: a single-shot `invoke` returning a
 * `BaseMessage`. The catalog hands a broad `LanguageModelLike`; we narrow it (via
 * `unknown`) at the factory boundary so the node stays strictly typed without `any`.
 */
interface InvokableLlm {
  invoke(messages: BaseMessage[], config?: RunnableConfig): Promise<BaseMessage>;
}

/** Extract plain-text content from an LLM response. */
function textOf(message: BaseMessage): string {
  return typeof message.content === "string" ? message.content : "";
}

/** Pull the latest human message text (a campaign brief), for brief-only runs. */
function latestBrief(messages: readonly BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.getType?.() === "human" && typeof m.content === "string") {
      return m.content;
    }
  }
  const last = messages[messages.length - 1];
  return last && typeof last.content === "string" ? last.content : "";
}

/**
 * Read the `GrowthGenerateConfig` from `configurable.growthGenerate`, falling back
 * to a minimal strategy derived from the latest human-message brief. Returns null
 * only when there is neither a config nor any brief to ground the run.
 */
function readGenerateConfig(
  config: RunnableConfig,
  messages: readonly BaseMessage[]
): GrowthGenerateConfig | null {
  const raw = (config.configurable as { growthGenerate?: unknown } | undefined)
    ?.growthGenerate;
  if (raw && typeof raw === "object" && "strategy" in raw) {
    return raw as GrowthGenerateConfig;
  }

  // Brief-only fallback: derive a minimal strategy from the latest human message.
  const brief = latestBrief(messages).trim();
  if (brief.length === 0) return null;
  const strategy: CampaignStrategy = { campaignId: "adhoc", brief };
  return { strategy };
}

/**
 * Create the growth-generate catalog graph.
 *
 * Architecture (single node — the composition lives inside `runGrowthGenerate`,
 * which loops once per funnel layer):
 * ```
 * START → generate → END
 * ```
 * The generate node bridges the injected LLM into the workflow's `CompleteFn`,
 * runs the pure `runGrowthGenerate`, and emits the drafts both on state and as a
 * JSON AIMessage (so callers / the run dashboard read the output off messages).
 *
 * NOTE: Return type is intentionally NOT annotated to preserve the concrete
 * CompiledStateGraph type for LangGraph CLI schema extraction.
 *
 * @param opts - Options with the injected LLM (tools unused by the node directly)
 * @returns Compiled LangGraph ready for invoke()
 */
export function createGrowthGenerateGraph(opts: CreateReactAgentGraphOptions) {
  const llm = opts.llm as unknown as InvokableLlm;

  async function generate(state: GrowthGenerateState, config: RunnableConfig) {
    const cfg = readGenerateConfig(config, state.messages);
    if (!cfg) {
      // Nothing to ground the run — emit an empty result, never throw.
      return {
        drafts: [],
        messages: [new AIMessage(JSON.stringify({ drafts: [] }))],
      };
    }

    // Bridge the injected LLM to the workflow's CompleteFn (one system+user call).
    const complete: CompleteFn = async ({ system, user }) => {
      const response = await llm.invoke(
        [new SystemMessage(system), new HumanMessage(user)],
        config
      );
      return textOf(response);
    };

    const drafts = await runGrowthGenerate({
      strategy: cfg.strategy,
      ...(cfg.findings ? { findings: cfg.findings } : {}),
      ...(cfg.funnelTargets !== undefined
        ? { funnelTargets: cfg.funnelTargets }
        : {}),
      ...(cfg.defaultPerLayer !== undefined
        ? { defaultPerLayer: cfg.defaultPerLayer }
        : {}),
      ...(cfg.maxPerLayer !== undefined ? { maxPerLayer: cfg.maxPerLayer } : {}),
      complete,
    });

    return {
      drafts,
      messages: [new AIMessage(JSON.stringify({ drafts }))],
    };
  }

  const builder = new StateGraph(GrowthGenerateStateAnnotation)
    .addNode("generate", generate)
    .addEdge("__start__", "generate")
    .addEdge("generate", "__end__");

  return builder.compile();
}
