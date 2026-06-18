// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/content/graph`
 * Purpose: Content production graph — a 4-node inner content loop for the beacon
 *   growth loop: ideate → draft → critique/revise → adapt-per-platform. The
 *   draft→critique→adapt arc is looped once per funnel layer (tofu/mofu/bofu) so
 *   the graph yields a small CLASSIFIED queue spanning the funnel — not one post.
 * Scope: Pure factory. Each node calls the injected LLM; emits one staged variant
 *   per (funnel layer × enabled channel). Does NOT execute graphs, read env, or do I/O.
 * Invariants:
 *   - PURE_FACTORY: no side effects, no env reads; LLM is injected
 *   - FOUR_NODE_CONTENT_LOOP: ideate, draft, critique_revise, adapt_per_platform
 *   - QUEUE_SPANS_FUNNEL: the run produces one variant per (layer × enabled channel),
 *     each tagged {funnelLayer, topic} — a classified funnel queue, not a single post
 *   - NO_POST_METRICS_WRITE: this module never references the post_metrics writer
 *   - TYPE_TRANSPARENT_RETURN: no explicit return type for CLI schema extraction
 * Side-effects: none
 * Links: docs/spec/beacon-growth-loop-v0.md §1, .context/specs/pr4-funnel.md
 * @public
 */

import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import { StateGraph } from "@langchain/langgraph";

import type { CreateReactAgentGraphOptions } from "../types";
import {
  ADAPT_PROMPT,
  CHANNEL_CONSTRAINTS,
  CRITIQUE_PROMPT,
  DEFAULT_CHANNEL_CONSTRAINTS,
  DRAFT_PROMPT,
  FUNNEL_LAYER_GUIDANCE,
  IDEATE_PROMPT,
  TOPIC_PROMPT,
} from "./prompts";
import {
  type ContentState,
  ContentStateAnnotation,
  type ContentVariant,
  FUNNEL_LAYERS,
  type FunnelLayer,
} from "./state";

/**
 * Graph name constant for routing.
 */
export const CONTENT_GRAPH_NAME = "content" as const;

/** Default channel when none configured (X is the v0 primary). */
const DEFAULT_ENABLED_CHANNELS = ["x"] as const;

/** Read enabled channels from RunnableConfig.configurable (graphs receive it at invoke). */
function readEnabledChannels(config: RunnableConfig): string[] {
  const raw = (config.configurable as { enabledChannels?: unknown } | undefined)
    ?.enabledChannels;
  if (Array.isArray(raw)) {
    const channels = raw.filter((c): c is string => typeof c === "string");
    if (channels.length > 0) return channels;
  }
  return [...DEFAULT_ENABLED_CHANNELS];
}

/** Extract plain-text content from an LLM response. */
function textOf(message: BaseMessage): string {
  return typeof message.content === "string" ? message.content : "";
}

/** Pull the latest human message text (the campaign brief). */
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

/** Best-effort parse of an angles JSON array; falls back to the raw text. */
function parseAngles(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw.trim());
    if (Array.isArray(parsed)) {
      const angles = parsed.filter((a): a is string => typeof a === "string");
      if (angles.length > 0) return angles;
    }
  } catch {
    // Not JSON — fall through.
  }
  return raw.trim().length > 0 ? [raw.trim()] : [];
}

/**
 * Create the content production graph.
 *
 * Architecture:
 * ```
 * START → ideate → draft → critique_revise → adapt_per_platform → END
 * ```
 * The adapt node emits one staged variant per enabled channel and writes the
 * final structured result as a JSON AIMessage (so callers / tests can read the
 * variants off the output messages).
 *
 * NOTE: Return type is intentionally NOT annotated to preserve the concrete
 * CompiledStateGraph type for LangGraph CLI schema extraction.
 *
 * @param opts - Options with the injected LLM (tools unused by the nodes directly)
 * @returns Compiled LangGraph ready for invoke()
 */
/**
 * Narrowed LLM surface the content nodes need: a single-shot `invoke` that
 * returns a `BaseMessage`. The catalog hands us a `LanguageModelLike` whose
 * `invoke` is intentionally broad; we narrow it (via `unknown`) at the factory
 * boundary so the nodes stay strictly typed without `any`.
 */
interface InvokableLlm {
  invoke(
    messages: BaseMessage[],
    config?: RunnableConfig
  ): Promise<BaseMessage>;
}

export function createContentGraph(opts: CreateReactAgentGraphOptions) {
  const llm = opts.llm as unknown as InvokableLlm;

  // Node 1 — IDEATE: expand the brief into distinct angles.
  async function ideate(state: ContentState, config: RunnableConfig) {
    const brief = latestBrief(state.messages);
    const response = await llm.invoke(
      [new SystemMessage(IDEATE_PROMPT), new HumanMessage(brief)],
      config
    );
    return {
      angles: parseAngles(textOf(response)),
      enabledChannels: readEnabledChannels(config),
    };
  }

  // Pick the angle for a funnel layer — one per layer, cycling if fewer angles.
  function angleForLayer(angles: string[], layerIndex: number, brief: string): string {
    if (angles.length === 0) return brief;
    return angles[layerIndex % angles.length] ?? angles[0] ?? brief;
  }

  // DRAFT one core post for a layer, framed by its funnel guidance.
  async function draftForLayer(
    layer: FunnelLayer,
    angle: string,
    config: RunnableConfig
  ): Promise<string> {
    const guidance = FUNNEL_LAYER_GUIDANCE[layer] ?? "";
    const response = await llm.invoke(
      [
        new SystemMessage(DRAFT_PROMPT),
        new HumanMessage(`${guidance}\n\nAngle: ${angle}`),
      ],
      config
    );
    return textOf(response);
  }

  // CRITIQUE/REVISE one core post (single self-revise pass).
  async function reviseDraft(
    draftText: string,
    config: RunnableConfig
  ): Promise<string> {
    const response = await llm.invoke(
      [
        new SystemMessage(CRITIQUE_PROMPT),
        new HumanMessage(`Draft:\n${draftText}`),
      ],
      config
    );
    return textOf(response) || draftText;
  }

  // TOPIC: distil the post's single subject into a short tag.
  async function topicOf(
    core: string,
    config: RunnableConfig
  ): Promise<string> {
    const response = await llm.invoke(
      [new SystemMessage(TOPIC_PROMPT), new HumanMessage(core)],
      config
    );
    const raw = textOf(response).trim().toLowerCase();
    return raw.length > 0 ? raw.slice(0, 80) : "general";
  }

  // Node 2 — DRAFT: first-pass core post for the TOFU layer (graph entry draft).
  async function draft(state: ContentState, config: RunnableConfig) {
    const brief = latestBrief(state.messages);
    const angle = angleForLayer(state.angles, 0, brief);
    return { draft: await draftForLayer("tofu", angle, config) };
  }

  // Node 3 — CRITIQUE/REVISE: one self-revise pass over the TOFU draft.
  async function critiqueRevise(state: ContentState, config: RunnableConfig) {
    return { revised: await reviseDraft(state.draft, config) };
  }

  // Node 4 — ADAPT-PER-PLATFORM: loop the draft→critique→adapt arc per funnel
  // layer, emitting one variant per (layer × enabled channel) — a classified queue.
  async function adaptPerPlatform(
    state: ContentState,
    config: RunnableConfig
  ) {
    const brief = latestBrief(state.messages);
    const channels =
      state.enabledChannels.length > 0
        ? state.enabledChannels
        : readEnabledChannels(config);

    const variants: ContentVariant[] = [];
    for (let i = 0; i < FUNNEL_LAYERS.length; i++) {
      const layer = FUNNEL_LAYERS[i] as FunnelLayer;
      // Reuse the already-drafted/revised TOFU core; draft fresh for mofu/bofu.
      const core =
        layer === "tofu"
          ? state.revised || state.draft
          : await reviseDraft(
              await draftForLayer(
                layer,
                angleForLayer(state.angles, i, brief),
                config
              ),
              config
            );
      const topic = await topicOf(core, config);

      for (const channel of channels) {
        const constraints =
          CHANNEL_CONSTRAINTS[channel] ?? DEFAULT_CHANNEL_CONSTRAINTS;
        const prompt = ADAPT_PROMPT.replace("{channel}", channel).replace(
          "{constraints}",
          constraints
        );
        const response = await llm.invoke(
          [new SystemMessage(prompt), new HumanMessage(`Core post:\n${core}`)],
          config
        );
        variants.push({
          funnelLayer: layer,
          topic,
          channel,
          text: textOf(response) || core,
        });
      }
    }

    // Emit the structured result as the final assistant message.
    const summary = JSON.stringify({ variants });
    return {
      variants,
      messages: [new AIMessage(summary)],
    };
  }

  const builder = new StateGraph(ContentStateAnnotation)
    .addNode("ideate", ideate)
    .addNode("draft", draft)
    .addNode("critique_revise", critiqueRevise)
    .addNode("adapt_per_platform", adaptPerPlatform)
    .addEdge("__start__", "ideate")
    .addEdge("ideate", "draft")
    .addEdge("draft", "critique_revise")
    .addEdge("critique_revise", "adapt_per_platform")
    .addEdge("adapt_per_platform", "__end__");

  return builder.compile();
}
